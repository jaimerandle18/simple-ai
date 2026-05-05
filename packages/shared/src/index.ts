// ========== Tenant ==========
export interface Tenant {
  tenantId: string;
  name: string;
  email: string;
  phone?: string;
  plan: 'free' | 'basic' | 'pro';
  status: 'active' | 'suspended' | 'cancelled';
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

// ========== User ==========
export type UserRole = 'owner' | 'admin' | 'agent';
export type AuthProvider = 'google' | 'facebook' | 'email';

export interface User {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: UserRole;
  authProvider: AuthProvider;
  lastLoginAt: string;
  createdAt: string;
}

// ========== Channel (WhatsApp) ==========
export interface Channel {
  tenantId: string;
  platform: 'whatsapp' | 'instagram' | 'messenger';
  phoneNumber?: string;
  displayName: string;
  wabaId?: string;
  phoneNumberId?: string;
  accessToken: string;
  active: boolean;
  createdAt: string;
}

// ========== Conversation ==========
export type ConversationStatus = 'open' | 'closed' | 'archived';

export interface Conversation {
  conversationId: string;
  tenantId: string;
  channelPhoneNumberId?: string;
  contactPhone: string;
  contactName?: string;
  contactProfilePic?: string;
  status: ConversationStatus;
  tags: string[];
  assignedTo: string;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview?: string;
  createdAt: string;
}

// ========== Message ==========
export type MessageDirection = 'inbound' | 'outbound';
export type MessageSender = 'contact' | 'bot' | 'user';
export type MessageType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'template';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  conversationId: string;
  messageId: string;
  tenantId: string;
  direction: MessageDirection;
  sender: MessageSender;
  type: MessageType;
  content: string;
  mediaUrl?: string;
  mediaCaption?: string;
  waMessageId?: string;
  status?: MessageStatus;
  timestamp: string;
}

// ========== Contact ==========
export interface Contact {
  tenantId: string;
  phone: string;
  name?: string;
  profilePic?: string;
  tags: string[];
  notes?: string;
  totalConversations: number;
  lastConversationAt?: string;
  metadata?: Record<string, string>;
  createdAt: string;
}

// ========== Agent Config ==========
export type AgentType = 'main' | 'prompt-assistant';

export interface AgentConfig {
  tenantId: string;
  agentType: AgentType;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  attachedFiles: { fileKey: string; fileName: string; uploadedAt: string }[];
  active: boolean;
  updatedAt: string;
}

// ========== Subscription ==========
export type SubscriptionStatus = 'active' | 'trial' | 'past_due' | 'cancelled';

export interface Subscription {
  tenantId: string;
  plan: string;
  status: SubscriptionStatus;
  mpSubscriptionId?: string;
  mpCustomerId?: string;
  messagesUsed: number;
  messagesLimit: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  createdAt: string;
}

// ========== Rule ==========
export interface Rule {
  tenantId: string;
  ruleId: string;
  name: string;
  trigger: 'message_received' | 'keyword' | 'intent';
  conditions: { field: string; operator: string; value: string }[];
  actions: { type: string; params: Record<string, string> }[];
  active: boolean;
  createdAt: string;
}

// ========== DynamoDB Keys ==========
export interface DynamoDBItem {
  PK: string;
  SK: string;
  [key: string]: unknown;
}
