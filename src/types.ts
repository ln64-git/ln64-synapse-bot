export interface MessageData {
    content: string;
    createdAt: Date;
    authorId: string;
    authorUsername: string;
    channelId: string;
    channelName: string;
}

export interface Conversation {
    startTime: Date;
    endTime: Date;
    messages: MessageData[];
}
