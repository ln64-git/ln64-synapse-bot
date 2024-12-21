declare module "node-nlp" {
    export class NlpManager {
        constructor(options?: {
            languages?: string[];
            nlu?: { log?: boolean };
            ner?: { useDuckling?: boolean };
        });

        addNamedEntityText(
            entityName: string,
            optionName: string,
            languages: string[],
            texts: string[],
        ): void;

        process(
            language: string,
            utterance: string,
        ): Promise<{
            entities: { entity: string; option: string }[];
        }>;
    }
}
