/** pdfjs-dist 的 worker 入口只提供运行时模块（WorkerMessageHandler），无类型声明。 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  const WorkerMessageHandler: unknown
  export { WorkerMessageHandler }
}
