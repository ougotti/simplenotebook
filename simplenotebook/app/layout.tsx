export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Simplenotebook</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body className="p-4">
        {children}
      </body>
    </html>
  );
}
