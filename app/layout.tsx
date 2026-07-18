import '../styles/globals.css'
import { AuthProvider } from '../hooks/useAuth'
import AuthGuard from '../components/AuthGuard'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Simplenotebook</title>
  {/* GitHub Pages の basePath (/simplenotebook) を考慮 */}
  <link rel="icon" href="/simplenotebook/favicon.ico" />
        {/* 描画前にテーマを適用してフラッシュを防ぐ (保存値がなければ OS 設定に追従) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="p-4 min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
        <AuthProvider>
          <AuthGuard>
            {children}
          </AuthGuard>
        </AuthProvider>
      </body>
    </html>
  )
}
