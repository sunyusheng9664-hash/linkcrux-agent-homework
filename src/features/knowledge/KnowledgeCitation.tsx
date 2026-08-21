export function KnowledgeCitation({ documentName, version, chunks }: { documentName: string; version: string; chunks: Array<{ sequence: number; text: string }> }) {
  return <details open><summary>查看引用</summary>{chunks.map((chunk) => <figure key={chunk.sequence}><figcaption>{documentName} {version} · 第 {chunk.sequence} 节</figcaption><blockquote>{chunk.text}</blockquote></figure>)}</details>
}
