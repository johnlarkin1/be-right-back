import { Metadata } from "next";
import DownloadClient from "./client";

export const metadata: Metadata = {
  title: "Download - Be Right Back",
  description:
    "Download Be Right Back for macOS. Local-first iMessage search and AI personas on Apple Silicon.",
};

export default function DownloadPage() {
  return <DownloadClient />;
}
