export async function appendMessage(base44, sessionId, role, text, blocks = null, attachmentName = null) {
  const rec = { session_id: sessionId, role, text: text || '' };
  if (blocks) rec.blocks = blocks;
  if (attachmentName) rec.attachment_name = attachmentName;
  return await base44.entities.ChatMessage.create(rec);
}