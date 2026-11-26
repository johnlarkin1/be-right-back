//! Live CPU, memory, and GPU samples for the ingestion screen.
//!
//! A sampler thread emits `system-resources` once per second while a
//! `ResourceSampler` guard is alive. Dropping the guard stops the thread.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);
const MAX_PROCS: usize = 8;

/// macOS memory pressure, from `kern.memorystatus_vm_pressure_level`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
#[serde(rename_all = "snake_case")]
pub enum MemoryPressure {
    Normal,
    Warn,
    Critical,
}

/// One process in the Be Right Back process tree.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct ProcSample {
    pub pid: u32,
    pub name: String,
    pub cpu_pct: f32,
    #[ts(type = "number")]
    pub rss: u64,
}

/// One resource reading. GPU fields are `None` when `ioreg` gives no data.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "desktop.ts")]
pub struct ResourceSample {
    #[ts(type = "number")]
    pub ts_ms: u64,
    pub cpu_pct: f32,
    pub cpu_cores: Vec<f32>,
    #[ts(type = "number")]
    pub mem_used: u64,
    #[ts(type = "number")]
    pub mem_total: u64,
    #[ts(type = "number")]
    pub swap_used: u64,
    #[ts(type = "number")]
    pub swap_total: u64,
    pub pressure: MemoryPressure,
    pub gpu_pct: Option<f32>,
    #[ts(type = "number | null")]
    pub gpu_mem: Option<u64>,
    pub procs: Vec<ProcSample>,
}

/// Keeps the sampler thread alive. Dropping it stops the thread.
pub struct ResourceSampler {
    stop: Arc<AtomicBool>,
}

impl ResourceSampler {
    pub fn start(app: AppHandle) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        std::thread::spawn(move || sample_loop(app, thread_stop));
        Self { stop }
    }
}

impl Drop for ResourceSampler {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

fn sample_loop(app: AppHandle, stop: Arc<AtomicBool>) {
    let mut sys = System::new();
    let own_pid = std::process::id();
    // CPU usage is a delta, so the first refresh only primes the counters.
    sys.refresh_cpu_usage();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    while !stop.load(Ordering::Relaxed) {
        // Sleep in short steps so a stop request takes effect quickly.
        let mut slept = Duration::ZERO;
        while slept < SAMPLE_INTERVAL && !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(100));
            slept += Duration::from_millis(100);
        }
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let sample = take_sample(&mut sys, own_pid);
        let _ = app.emit("system-resources", sample);
    }
}

fn take_sample(sys: &mut System, own_pid: u32) -> ResourceSample {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let edges: Vec<(u32, u32)> = sys
        .processes()
        .iter()
        .filter_map(|(pid, p)| p.parent().map(|parent| (pid.as_u32(), parent.as_u32())))
        .collect();
    let family = descendants(own_pid, &edges);

    let mut procs: Vec<ProcSample> = family
        .iter()
        .filter_map(|pid| sys.process(Pid::from_u32(*pid)))
        .map(|p| ProcSample {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().into_owned(),
            cpu_pct: p.cpu_usage(),
            rss: p.memory(),
        })
        .collect();
    procs.sort_by(|a, b| b.cpu_pct.total_cmp(&a.cpu_pct));
    procs.truncate(MAX_PROCS);

    let gpu = read_gpu();
    ResourceSample {
        ts_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        cpu_pct: sys.global_cpu_usage(),
        cpu_cores: sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
        swap_used: sys.used_swap(),
        swap_total: sys.total_swap(),
        pressure: read_pressure(),
        gpu_pct: gpu.map(|(pct, _)| pct),
        gpu_mem: gpu.map(|(_, mem)| mem),
        procs,
    }
}

/// Return `root` and every process below it, given `(pid, parent_pid)` edges.
fn descendants(root: u32, edges: &[(u32, u32)]) -> HashSet<u32> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, parent) in edges {
        children.entry(*parent).or_default().push(*pid);
    }
    let mut found = HashSet::from([root]);
    let mut stack = vec![root];
    while let Some(pid) = stack.pop() {
        for child in children.get(&pid).into_iter().flatten() {
            if found.insert(*child) {
                stack.push(*child);
            }
        }
    }
    found
}

fn read_pressure() -> MemoryPressure {
    Command::new("sysctl")
        .args(["-n", "kern.memorystatus_vm_pressure_level"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| parse_pressure(&s))
        .unwrap_or(MemoryPressure::Normal)
}

fn parse_pressure(raw: &str) -> MemoryPressure {
    match raw.trim() {
        "2" => MemoryPressure::Warn,
        "4" => MemoryPressure::Critical,
        _ => MemoryPressure::Normal,
    }
}

/// GPU utilization and in-use memory from the IOAccelerator registry entry.
/// This works without sudo. Returns `None` when the keys are missing.
fn read_gpu() -> Option<(f32, u64)> {
    let out = Command::new("ioreg")
        .args(["-r", "-d", "1", "-w0", "-c", "IOAccelerator"])
        .output()
        .ok()?;
    parse_ioreg_gpu(&String::from_utf8_lossy(&out.stdout))
}

fn parse_ioreg_gpu(text: &str) -> Option<(f32, u64)> {
    let util = number_after(text, "\"Device Utilization %\"=")?;
    let mem = number_after(text, "\"In use system memory\"=")?;
    Some((util as f32, mem))
}

fn number_after(text: &str, key: &str) -> Option<u64> {
    let start = text.find(key)? + key.len();
    let digits: String = text[start..].chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const IOREG: &str = r#""PerformanceStatistics" = {"In use system memory (driver)"=0,"Alloc system memory"=23165566976,"Tiler Utilization %"=2,"Renderer Utilization %"=3,"Device Utilization %"=84,"In use system memory"=18276794368}"#;

    #[test]
    fn parses_gpu_from_ioreg() {
        assert_eq!(parse_ioreg_gpu(IOREG), Some((84.0, 18_276_794_368)));
    }

    #[test]
    fn missing_gpu_keys_give_none() {
        assert_eq!(parse_ioreg_gpu("\"Other\"=1"), None);
        assert_eq!(parse_ioreg_gpu(""), None);
    }

    #[test]
    fn driver_memory_key_does_not_match() {
        let text = r#""In use system memory (driver)"=7,"Device Utilization %"=1"#;
        assert_eq!(parse_ioreg_gpu(text), None);
    }

    #[test]
    fn maps_pressure_levels() {
        assert_eq!(parse_pressure("1\n"), MemoryPressure::Normal);
        assert_eq!(parse_pressure("2\n"), MemoryPressure::Warn);
        assert_eq!(parse_pressure("4\n"), MemoryPressure::Critical);
        assert_eq!(parse_pressure(""), MemoryPressure::Normal);
    }

    #[test]
    fn finds_all_descendants_only() {
        // 1 -> 2 -> 3, 1 -> 4, and 9 -> 10 is unrelated.
        let edges = [(2, 1), (3, 2), (4, 1), (10, 9)];
        let found = descendants(1, &edges);
        assert_eq!(found, HashSet::from([1, 2, 3, 4]));
    }
}
