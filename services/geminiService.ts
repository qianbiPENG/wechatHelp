import { GoogleGenAI, Type } from "@google/genai";
import { ClassificationResult, NoteItem, NoteType } from "../types";

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error("API Key is missing. Please check your .env file or Vercel settings.");
    throw new Error("API Key not found");
  }
  return new GoogleGenAI({ apiKey });
};

export const classifyContent = async (
  text: string, 
  media?: { mimeType: string, data: string }
): Promise<ClassificationResult> => {
  const ai = getClient();
  
  const parts: any[] = [];
  
  // Add media if present
  if (media) {
    parts.push({
      inlineData: {
        mimeType: media.mimeType,
        data: media.data
      }
    });
  }

  // Add text prompt
  parts.push({
    text: `Analyze the provided content and categorize it.

    **Input Handling:**
    - If AUDIO is provided: Transcribe the speech VERBATIM into the 'content' field. Then analyze that text.
    - If IMAGE/VIDEO is provided and no text: Describe in detail what is in the media into the 'content' field.
    - If TEXT is provided: Use it as the content.
    
    **Categories:**
    - "thought": Personal reflections, ideas, voice notes, or fleeting thoughts.
    - "article": Content that looks like an excerpt from an article, news, newsletter, or a video summary.
    - "chat": Dialogue, conversation logs, or questions/answers.
    
    **Tasks:**
    1. Determine the category.
    2. Provide a short, catchy title (max 6 words).
    3. Provide a one-sentence summary.
    4. Extract the primary URL from the text if present (put in 'sourceUrl').
    5. Return the full text (or transcription) in the 'content' field.
    
    Text context (if any): "${text}"`
  });
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: {
              type: Type.STRING,
              enum: ["thought", "article", "chat"],
              description: "The category of the content"
            },
            title: {
              type: Type.STRING,
              description: "A short catchy title"
            },
            summary: {
              type: Type.STRING,
              description: "A one-sentence summary"
            },
            content: {
               type: Type.STRING,
               description: "The full text content, extracted text, or audio transcription."
            },
            sourceUrl: {
              type: Type.STRING,
              description: "The extracted URL if found, otherwise null",
              nullable: true
            }
          },
          required: ["type", "title", "summary", "content"]
        }
      }
    });

    // Robust JSON parsing
    let jsonStr = response.text || "{}";
    // Clean markdown code blocks if present
    jsonStr = jsonStr.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    
    const result = JSON.parse(jsonStr);
    
    // Map string to enum safely
    let noteType = NoteType.THOUGHT;
    if (result.type === 'article') noteType = NoteType.ARTICLE;
    if (result.type === 'chat') noteType = NoteType.CHAT;

    return {
      type: noteType,
      title: result.title || "Untitled Note",
      summary: result.summary || "No summary available.",
      content: result.content || text, // Fallback to input text if AI doesn't return it
      sourceUrl: result.sourceUrl || undefined
    };
  } catch (error) {
    console.error("Gemini API Error in classifyContent:", error);
    throw error;
  }
};

export const generateWeeklyReport = async (items: NoteItem[]): Promise<string> => {
  const ai = getClient();
  
  const itemsJson = JSON.stringify(items.map(item => ({
    type: item.type,
    title: item.title,
    content: item.content, // sending full text content for context
    summary: item.summary,
    sourceUrl: item.sourceUrl,
    hasMedia: !!item.media,
    date: new Date(item.createdAt).toLocaleDateString()
  })));

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview", // Using Pro for better reasoning on reports
      contents: `You are a helpful personal assistant. Here is a list of my digital inputs from this week (thoughts, articles read, videos watched, chats, voice notes). 
      
      Please generate a high-quality Weekly Report in Markdown format.
      
      Structure:
      1. **Weekly Highlight**: One major theme or insight from the week.
      2. **Deep Dives (Reading & Watching)**: Summarize key learnings. 
         **CRITICAL**: If an item has a 'sourceUrl', you MUST format the title as a markdown link: [Title](sourceUrl). 
         If it was a video upload (hasMedia=true), mention it was a video.
      3. **Mind Sparks (Thoughts & Voice Notes)**: Synthesize my random thoughts and voice memos into coherent ideas.
      4. **Conversations (Chats)**: Key takeaways from conversations.
      5. **Action Plan**: Suggested 3 actions based on this content.

      Style: Professional yet personal, encouraging, and clear. Use emojis where appropriate.
      
      Data:
      ${itemsJson}`
    });

    return response.text || "Failed to generate report.";
  } catch (error) {
    console.error("Gemini API Error in generateWeeklyReport:", error);
    return "Failed to generate report. Please check your network or API quota.";
  }
};