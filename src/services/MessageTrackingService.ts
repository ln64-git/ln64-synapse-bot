import { Client, Events, Message, Collection } from "discord.js";
import { DatabaseService } from "./DatabaseService.js";

export class MessageTrackingService {
  constructor(
    private client: Client,
    private dbService: DatabaseService
  ) { }

  initialize(): void {
    this.client.on(Events.MessageCreate, this.handleMessageCreate.bind(this));
    this.client.on(Events.MessageUpdate, (oldMessage, newMessage) => this.handleMessageUpdate(oldMessage, newMessage));
    this.client.on(Events.MessageDelete, (message) => this.handleMessageDelete(message));
    this.client.on(Events.MessageBulkDelete, (messages) => this.handleMessageBulkDelete(messages));
  }

  private async handleMessageCreate(message: Message): Promise<void> {
    try {
      // Skip bot messages and non-guild messages
      if (message.author.bot || !message.guild) return;

      console.log(`📝 Message created: ${message.author.tag} in #${message.channel.isTextBased() && 'name' in message.channel ? message.channel.name : 'Unknown'}`);

      // Create message in database
      await this.dbService.createMessage(message);

      // Update user's message count and last seen
      await this.dbService.incrementMessageCount(message.author.id, message.guild.id);

    } catch (error) {
      console.error(`❌ Error handling message create:`, error);
    }
  }

  private async handleMessageUpdate(oldMessage: any, newMessage: Message): Promise<void> {
    try {
      // Skip bot messages and non-guild messages
      if (newMessage.author.bot || !newMessage.guild) return;

      // Skip if content hasn't changed
      if (oldMessage && oldMessage.content === newMessage.content) return;

      console.log(`✏️ Message updated: ${newMessage.author.tag} in #${newMessage.channel.isTextBased() && 'name' in newMessage.channel ? newMessage.channel.name : 'Unknown'}`);

      // Update message in database
      await this.dbService.updateMessage(newMessage);

    } catch (error) {
      console.error(`❌ Error handling message update:`, error);
    }
  }

  private async handleMessageDelete(message: any): Promise<void> {
    try {
      // Skip if message is not available or from a bot
      if (!message || message.author.bot || !message.guild) return;

      console.log(`🗑️ Message deleted: ${message.author.tag} in #${message.channel.isTextBased() && 'name' in message.channel ? message.channel.name : 'Unknown'}`);

      // Mark message as deleted in database
      await this.dbService.markMessageAsDeleted(message.id);

    } catch (error) {
      console.error(`❌ Error handling message delete:`, error);
    }
  }

  private async handleMessageBulkDelete(messages: any): Promise<void> {
    try {
      console.log(`🗑️ Bulk delete: ${messages.size} messages`);

      // Mark all messages as deleted
      const messageIds = messages.map((msg: any) => msg.id);
      for (const messageId of messageIds) {
        await this.dbService.markMessageAsDeleted(messageId);
      }

    } catch (error) {
      console.error(`❌ Error handling bulk message delete:`, error);
    }
  }
}
