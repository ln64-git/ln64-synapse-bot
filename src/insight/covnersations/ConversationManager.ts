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
    private SIMILARITY_THRESHOLD = 0.7;
    private KEYWORD_IMPORTANCE = 0.3; // Reduce keyword weight

    public async processMessages(messages: Message<true>[]): Promise<void> {
        for (const message of messages) {
            console.log(
                `Processing message ${
                    messages.indexOf(message) + 1
                } of ${messages.length}`,
            );
            await this.processSingleMessage(message);
        }
        this.mergeSimilarThreads();
    }

    private async processSingleMessage(message: Message<true>): Promise<void> {
        if (!this.isProcessable(message)) return;

        const displayName = message.member?.displayName ||
            message.author.username;
        const { keywords, embedding } = await this
            .getMessageKeywordsAndEmbedding(message);

        const messageWithEmbed = message as DiscordMessageWithEmbedding;
        messageWithEmbed.cleanContentEmbedding = embedding ?? undefined;

        let thread = this.findRelatedThread(message, keywords, embedding);
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
        return (
            message.content.trim().length > 0 &&
            !/^https?:\/\/\S+$/.test(message.content) &&
            message.attachments.size === 0
        );
    }

    private hasKeywordOverlap(
        existingKeywords: string[],
        newKeywords: string[],
    ): boolean {
        if (existingKeywords.length === 0 || newKeywords.length === 0) {
            return false;
        }

        // Define stopwords that should be ignored when comparing keywords
        const STOPWORDS = new Set([
            "fix",
            "economy",
            "somehow",
            "real",
            "believable",
            "bullshit",
            "lets",
            "go",
        ]);

        // Filter out stopwords
        const filteredExisting = existingKeywords.filter((word) =>
            !STOPWORDS.has(word.toLowerCase())
        );
        const filteredNew = newKeywords.filter((word) =>
            !STOPWORDS.has(word.toLowerCase())
        );

        if (filteredExisting.length === 0 || filteredNew.length === 0) {
            return false; // If only stopwords are left, they are not related
        }

        // Convert to sets for comparison
        const existingSet = new Set(
            filteredExisting.map((word) => word.toLowerCase()),
        );
        const newSet = new Set(filteredNew.map((word) => word.toLowerCase()));

        // Find the intersection
        const intersection = [...existingSet].filter((word) =>
            newSet.has(word)
        );

        // Calculate the overlap ratio (percentage of shared keywords)
        const overlapRatio = intersection.length /
            Math.min(existingSet.size, newSet.size);

        return overlapRatio >= 0.4; // Require at least 40% overlap to merge
    }

    public async getMessageKeywordsAndEmbedding(
        message: Message,
    ): Promise<{ keywords: string[]; embedding: number[] | null }> {
        const keywords = await extractKeywordsWithOpenAi(message.content);
        const embedding = message.content.length >= 10
            ? await getEmbeddingBatch([message.content])
            : null;

        return { keywords, embedding: embedding ? embedding[0] : null };
    }

    private mergeSimilarThreads(): void {
        let merged = false;
        let mergeAttempts = 0; // Prevent infinite loops
        const MAX_MERGE_ATTEMPTS = 10; // Adjust as needed

        do {
            merged = false; // Reset for each iteration
            for (let i = 0; i < this.threads.length; i++) {
                for (let j = i + 1; j < this.threads.length; j++) {
                    const threadA = this.threads[i];
                    const threadB = this.threads[j];

                    if (this.shouldMergeThreads(threadA, threadB)) {
                        console.log(
                            `Merging thread ${threadB.id} into ${threadA.id}`,
                        );
                        this.threads[i] = this.mergeTwoThreads(
                            threadA,
                            threadB,
                        );
                        this.threads.splice(j, 1);
                        merged = true;
                        break;
                    }
                }
                if (merged) break; // Restart merge check
            }

            mergeAttempts++;
            if (mergeAttempts >= MAX_MERGE_ATTEMPTS) {
                console.warn(
                    "Reached max merge attempts, stopping further merges.",
                );
                break;
            }
        } while (merged);
    }

    private mergeTwoThreads(threadA: Thread, threadB: Thread): Thread {
        return {
            id: threadA.id,
            messageCount: threadA.messageCount + threadB.messageCount,
            messages: [...threadA.messages, ...threadB.messages].sort((a, b) =>
                a.createdTimestamp - b.createdTimestamp
            ),
            participants: Array.from(
                new Set([...threadA.participants, ...threadB.participants]),
            ),
            startTime: threadA.startTime < threadB.startTime
                ? threadA.startTime
                : threadB.startTime,
            lastActive: threadA.lastActive > threadB.lastActive
                ? threadA.lastActive
                : threadB.lastActive,
            keywords: Array.from(
                new Set([...threadA.keywords, ...threadB.keywords]),
            ),
            threadEmbedding: threadA.threadEmbedding || threadB.threadEmbedding,
        };
    }

    private shouldMergeThreads(threadA: Thread, threadB: Thread): boolean {
        // Ensure at least 50% of participants overlap
        const commonParticipants =
            threadA.participants.filter((p) => threadB.participants.includes(p))
                .length;
        if (commonParticipants / threadA.participants.length < 0.5) {
            return false;
        }

        // Apply improved keyword overlap logic
        if (this.hasKeywordOverlap(threadA.keywords, threadB.keywords)) {
            return true;
        }

        // Check embedding similarity
        if (threadA.threadEmbedding && threadB.threadEmbedding) {
            const similarity = this.cosineSimilarity(
                threadA.threadEmbedding,
                threadB.threadEmbedding,
            );
            return similarity > this.SIMILARITY_THRESHOLD;
        }

        return false;
    }

    private findRelatedThread(
        message: Message<true>,
        keywords: string[],
        embedding: number[] | null,
    ): Thread | null {
        let bestMatch: Thread | null = null;
        let highestScore = this.SIMILARITY_THRESHOLD;

        for (const thread of this.threads) {
            // Require participant overlap if the same user dominates a thread
            const participantMatch = thread.participants.includes(
                message.author.username,
            );

            // Check keyword overlap but reduce its influence
            const keywordScore =
                this.getKeywordOverlap(thread.keywords, keywords) *
                this.KEYWORD_IMPORTANCE;

            // Check embedding similarity
            let embeddingScore = 0;
            if (embedding && thread.threadEmbedding) {
                embeddingScore = this.cosineSimilarity(
                    thread.threadEmbedding,
                    embedding,
                );
            }

            const totalScore = embeddingScore + keywordScore;

            if (totalScore > highestScore && participantMatch) {
                highestScore = totalScore;
                bestMatch = thread;
            }
        }
        return bestMatch;
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

    private getKeywordOverlap(
        existingKeywords: string[],
        newKeywords: string[],
    ): number {
        const matches =
            newKeywords.filter((kw) => existingKeywords.includes(kw)).length;
        return matches /
            Math.max(existingKeywords.length, newKeywords.length, 1);
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
        const magnitudeA = Math.sqrt(
            vecA.reduce((sum, val) => sum + val * val, 0),
        );
        const magnitudeB = Math.sqrt(
            vecB.reduce((sum, val) => sum + val * val, 0),
        );

        return magnitudeA && magnitudeB
            ? dotProduct / (magnitudeA * magnitudeB)
            : 0;
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
                messages: messages.map((msg) => convertToTrimmedMessage(msg)),
            }));
    }
}
