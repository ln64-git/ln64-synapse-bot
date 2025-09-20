export interface UserData {
  _id?: string;
  userId: string;
  username: string;
  discriminator: string;
  avatar?: string;
  guildId: string;
  roles: string[]; // Array of role IDs
  joinedAt: Date;
  leftAt?: Date;
  isActive: boolean;
  lastSeen: Date;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageData {
  _id?: string;
  messageId: string;
  userId: string;
  username: string;
  channelId: string;
  channelName: string;
  guildId: string;
  content: string;
  characterCount: number; // Number of characters in the message
  timestamp: Date;
  editedAt?: Date;
  deletedAt?: Date;
  isDeleted: boolean;
  isEdited: boolean;
  attachments: string[]; // Array of attachment URLs
  embeds: any[]; // Array of embed objects
  reactions: ReactionData[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ReactionData {
  emoji: string;
  count: number;
  users: string[]; // Array of user IDs who reacted
}

export interface UserRoleHistory {
  _id?: string;
  userId: string;
  guildId: string;
  roleId: string;
  roleName: string;
  action: 'added' | 'removed';
  timestamp: Date;
  reason?: string;
}

export interface UserRanking {
  userId: string;
  username: string;
  vcMinutes: number;
  characterCount: number;
  messageCount: number;
  combinedScore: number;
  rank: number;
}

export interface UserStats {
  userId: string;
  username: string;
  messageCount: number;
  characterCount: number;
  vcMinutes: number;
  vcHours: number;
  rank: number;
  totalUsers: number;
}

export interface DatabaseCollections {
  users: UserData;
  messages: MessageData;
  userRoleHistory: UserRoleHistory;
}
