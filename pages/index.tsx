import Head from 'next/head'
import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to the new app structure
    router.replace('/notes/new')
  }, [router])

  return (
    <div className="max-w-xl mx-auto">
      <Head>
        <title>Simplenotebook</title>
        {/* GitHub Pages の basePath (/simplenotebook) を考慮 */}
        <link rel="icon" href="/simplenotebook/favicon.ico" />
      </Head>
      <div className="text-center">
        <p>Redirecting...</p>
      </div>
    </div>
  )
}
