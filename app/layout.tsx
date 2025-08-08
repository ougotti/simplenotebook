import '../styles/globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Simplenotebook</title>
  {/* GitHub Pages の basePath (/simplenotebook) を考慮 */}
  <link rel="icon" href="/simplenotebook/favicon.ico" />
      </head>
      <body className="p-4">
        {children}
      </body>
    </html>
  )
}
