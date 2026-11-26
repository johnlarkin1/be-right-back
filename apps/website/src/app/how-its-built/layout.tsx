import { Header } from "@/components/shared/header";
import { SidebarNav } from "@/components/how-its-built";
import { SiteFooter } from "@/components/shared/site-footer";

export default function HowItsBuiltLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-crt-bg cursor-auto [&_a]:cursor-pointer [&_button]:cursor-pointer" style={{ cursor: "auto" }}>
      <Header />
      <div className="min-h-screen bg-crt-bg pt-16">
        <div className="max-w-[1600px] mx-auto px-5 lg:px-8 pt-10 pb-14 md:pt-14 md:pb-[120px]">
          <div className="flex gap-8 lg:gap-12">
            {/* Sidebar - hidden on mobile, shown on lg+ */}
            <aside className="hidden lg:block w-[240px] flex-shrink-0">
              <div className="sticky top-24">
                <SidebarNav />
              </div>
            </aside>

            {/* Main content - grows to fill space */}
            <main className="flex-1 min-w-0">
              {children}
            </main>
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
