/** Host-owned, session-bound input actions; never replace the draft or submit it. */
export interface ComposerInputActions {
  captureInsertion(): { start: number; end: number; draftRev: number }
  insertText(text: string, span: { start: number; end: number; draftRev: number }): boolean
}

function fileMention(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (!normalized || /["\u0000-\u001f\u007f]/u.test(normalized)) throw new Error('文件路径不能作为对话引用')
  return `@"${normalized}"`
}

/** Capture before an asynchronous save so intervening typing cannot be overwritten. */
export function prepareCompositionReference(input: ComposerInputActions | undefined, project: string, id: string): (asset: string) => void {
  if (!input) throw new Error('宿主暂未提供输入框引用能力，请更新宿主后重试。')
  const root = project.replaceAll('\\', '/').replace(/\/+$/, '')
  const path = (relative: string) => root && root !== '.' ? `${root}/${relative}` : relative
  const manifest = fileMention(path('groups.json'))
  const captured = input.captureInsertion()
  // Insert after a selected range rather than replacing the user's selected words.
  const span = { ...captured, start: captured.end }
  return asset => {
    const text = `\n\n修改拼图 ${JSON.stringify(id)}：\n${fileMention(path(asset))}\n${manifest}\n请读取该图组的现有布局，保留未要求调整的部分。沿用原 ID 和文件名，compose_panels 的 output 固定为 ${JSON.stringify(path(asset))}，不要传 create:true；只有我明确要求新建或另存时才创建新图。\n修改意见：`
    if (!input.insertText(text, span)) throw new Error('输入框已变化或暂不可编辑，未加入引用；请再次点击「加入对话」。')
  }
}
