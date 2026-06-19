import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Breadcrumbs } from "@/components/layout/Breadcrumbs"
import { Toaster } from "sonner"

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")

  return (
    <SidebarProvider>
      <AppSidebar user={session.user} />
      <SidebarInset className="flex flex-col h-screen min-w-0 overflow-x-hidden">
        <header className="flex h-10 shrink-0 items-center border-b bg-background px-4">
          <Breadcrumbs />
        </header>
        <main className="flex-1 overflow-hidden bg-background p-5 flex flex-col">
          {children}
        </main>
      </SidebarInset>
      <Toaster position="top-center" richColors closeButton duration={6000} />
    </SidebarProvider>
  )
}
