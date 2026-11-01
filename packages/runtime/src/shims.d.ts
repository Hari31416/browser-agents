declare module 'process/browser' {
  const browserProcess: {
    env: Record<string, string | undefined>
    [key: string]: unknown
  }
  export default browserProcess
}

declare module 'process/browser.js' {
  const browserProcess: {
    env: Record<string, string | undefined>
    [key: string]: unknown
  }
  export default browserProcess
}
