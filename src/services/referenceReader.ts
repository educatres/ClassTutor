import * as pdfjsLib from 'pdfjs-dist'
// pdfjs exposes the worker as a Vite asset; the package does not ship a TS declaration for the query suffix.
// @ts-ignore -- Vite resolves ?url at build time.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export type TeacherReference = { id: string; name: string; type: 'pdf' | 'text'; pages?: number; text: string; size: number }

export async function readTeacherReference(file: File): Promise<TeacherReference> {
  const id = crypto.randomUUID()
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.map((item: any) => item.str || '').join(' ').replace(/\s+/g, ' ').trim()
      pages.push('[第 ' + pageNumber + ' 頁]\n' + text)
    }
    return { id, name: file.name, type: 'pdf', pages: pdf.numPages, text: pages.join('\n\n'), size: file.size }
  }
  return { id, name: file.name, type: 'text', text: await file.text(), size: file.size }
}
