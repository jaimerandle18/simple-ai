/**
 * Test Chat Adapter — routes through the real pipeline but writes to DynamoDB instead of sending via API.
 * Used by the test-chat feature in the dashboard.
 */
import { ChannelAdapter, NormalizedMessage, SendTextResult } from './base';

export class TestChatAdapter extends ChannelAdapter {
  channel = 'test' as const;

  parseWebhook(): NormalizedMessage[] { return []; }

  async sendText(args: { tenantId: string; externalUserId: string; text: string }): Promise<SendTextResult> {
    // No-op: the pipeline saves messages to DynamoDB, we don't need to send anywhere
    return { externalMessageId: `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
  }

  async sendImage(args: { tenantId: string; externalUserId: string; imageUrl: string; caption?: string }): Promise<SendTextResult> {
    return { externalMessageId: `test_img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
  }

  async markAsRead(): Promise<void> {}

  canSendOutside24hWindow() { return true; }
  getMaxTextLength() { return 10000; }
  supportsButtons() { return false; }
  supportsMarkdown() { return true; }
}
