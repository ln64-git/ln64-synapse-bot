import type { Message } from "discord.js";
import dotenv from "dotenv";
import { convertToTrimmedMessage } from "../../utils/utils";
import type { DiscordMessageWithEmbedding, Thread } from "./types";
import { getEmbeddingBatch } from "./utils";
import { extractKeywordsWithOpenAi } from "./extractKeywords";

dotenv.config();

export class ConversationManager {
    private threadIdCounter = 0;
    private threads: Thread[] = [];

    public async processMessages(messages: Message<true>[]): Promise<void> {
        for (const message of messages) {
            await this.processSingleMessage(message);
        }
    }

    private async processSingleMessage(message: Message<true>): Promise<void> {
        if (!this.isProcessable(message)) return;

        const displayName = message.member?.displayName ||
            message.author.username;
        const { keywords, embedding } = await this
            .getMessageKeywordsAndEmbedding(message);

        const messageWithEmbed = message as DiscordMessageWithEmbedding;
        messageWithEmbed.cleanContentEmbedding = embedding ?? undefined;

        let thread = this.findRelatedThread(keywords);
        if (!thread) {
            this.createNewThread(messageWithEmbed, keywords, displayName);
            return;
        }

        this.assignMessageToThread(
            thread,
            messageWithEmbed,
            keywords,
            displayName,
        );
    }

    private isProcessable(message: Message): boolean {
        return message.content.trim().length > 0 &&
            !/^https?:\/\/\S+$/.test(message.content) &&
            message.attachments.size === 0;
    }

    public async getMessageKeywordsAndEmbedding(
        message: Message,
    ): Promise<{ keywords: string[]; embedding: number[] | null }> {
        const keywords = await extractKeywordsWithOpenAi(message.content);
        const embedding = message.content.length >= 10
            ? await getEmbeddingBatch([message.content])
            : null;

        // const keywords = [""];
        // const embedding: (number[] | null)[] = [];

        return { keywords, embedding: embedding ? embedding[0] : null };
    }

    private findRelatedThread(keywords: string[]): Thread | null {
        for (const thread of this.threads) {
            if (this.hasKeywordOverlap(thread.keywords, keywords)) {
                return thread;
            }
        }
        return null;
    }

    private createNewThread(
        message: DiscordMessageWithEmbedding,
        keywords: string[],
        displayName: string,
    ): void {
        const newThread: Thread = {
            id: this.threadIdCounter++,
            messageCount: 1,
            messages: [message],
            participants: [displayName],
            startTime: new Date(),
            lastActive: new Date(),
            keywords,
            threadEmbedding: message.cleanContentEmbedding ?? undefined,
        };

        this.threads.push(newThread);
    }

    private assignMessageToThread(
        thread: Thread,
        message: DiscordMessageWithEmbedding,
        keywords: string[],
        displayName: string,
    ): void {
        if (thread.messages.some((msg) => msg.id === message.id)) return;

        thread.messages.push(message);
        thread.messageCount++;
        thread.lastActive = new Date();
        thread.keywords = [...new Set([...thread.keywords, ...keywords])];

        if (!thread.participants.includes(displayName)) {
            thread.participants.push(displayName);
        }
    }

    private hasKeywordOverlap(
        existingKeywords: string[],
        newKeywords: string[],
    ): boolean {
        return newKeywords.some((kw) => existingKeywords.includes(kw));
    }

    public getSortedThreads(): object[] {
        return this.threads
            .sort((a, b) =>
                new Date(b.lastActive).getTime() -
                new Date(a.lastActive).getTime()
            )
            .map(({ id, messageCount, participants, keywords, messages }) => ({
                id,
                messageCount,
                participants,
                keywords,
                messages: messages.map((msg) => convertToTrimmedMessage(msg)), // Use helper function
            }));
    }
}
