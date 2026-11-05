interface ConversationSender { send(text: string): Promise<void> }

export interface SessionScopes {
  scope(id: string): { get(name: 'conversation'): ConversationSender | undefined } | undefined
}

/** Borrowed session contexts resolve services with get(), as the host UI does. */
export async function sendSessionMessage(sessions: SessionScopes, sessionId: string, text: string): Promise<void> {
  const scope = sessions.scope(sessionId)
  if (!scope) throw new Error('会话未加载，请打开该会话后重试。')
  const conversation = scope.get('conversation')
  if (!conversation) throw new Error('宿主会话服务暂不可用，请稍后重试。')
  await conversation.send(text)
}
