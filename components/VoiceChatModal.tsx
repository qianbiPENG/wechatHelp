import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { X, Mic, MicOff, Volume2, Loader2 } from 'lucide-react';
import { createBlob, decodeAudioData, base64ToUint8Array } from '../utils/audioUtils';
import { NoteItem } from '../types';

interface VoiceChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  notes: NoteItem[];
}

const VoiceChatModal: React.FC<VoiceChatModalProps> = ({ isOpen, onClose, notes }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false); // User is speaking
  const [isAIResponding, setIsAIResponding] = useState(false); // AI is generating audio
  const [error, setError] = useState<string | null>(null);

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Playback Refs
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Connection Ref
  const sessionRef = useRef<any>(null);

  const cleanupAudio = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
    
    // Stop all playing sources
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();
    
    setIsConnected(false);
    setIsSpeaking(false);
    setIsAIResponding(false);
  }, []);

  const connectToLiveAPI = async () => {
    try {
      setError(null);
      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error("No API Key");

      const ai = new GoogleGenAI({ apiKey });

      // Build context from notes
      const contextSummary = notes.slice(0, 50).map(n => `[${n.type.toUpperCase()}] ${n.title}: ${n.summary}`).join('\n');
      const systemInstruction = `You are my personal WeChat assistant. I have sent you various articles, thoughts, and chats this week. 
      Your goal is to discuss these with me, help me reflect, or answer questions about them.
      
      Here is a summary of my recent content:
      ${contextSummary}
      
      Be concise, friendly, and conversational. Spoken language style.`;

      // Setup Audio Contexts
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const outputNode = outputAudioContextRef.current.createGain();
      outputNode.connect(outputAudioContextRef.current.destination);

      // Get Mic Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Connect Live API
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onopen: () => {
            console.log("Live API Connected");
            setIsConnected(true);

            // Start Input Streaming
            if (!inputAudioContextRef.current || !streamRef.current) return;
            
            const source = inputAudioContextRef.current.createMediaStreamSource(streamRef.current);
            sourceRef.current = source;
            
            const processor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              // Simple VAD visualization logic (check volume)
              const sum = inputData.reduce((a, b) => a + Math.abs(b), 0);
              const avg = sum / inputData.length;
              if (avg > 0.01) setIsSpeaking(true);
              else setIsSpeaking(false);

              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const serverContent = message.serverContent;
            
            // Audio Output Handling
            const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
                setIsAIResponding(true);
                const ctx = outputAudioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                
                const audioBuffer = await decodeAudioData(
                    base64ToUint8Array(base64Audio),
                    ctx,
                    24000,
                    1
                );
                
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputNode);
                
                source.addEventListener('ended', () => {
                    sourcesRef.current.delete(source);
                    if (sourcesRef.current.size === 0) setIsAIResponding(false);
                });
                
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
            }

            // Handle interruption
            if (serverContent?.interrupted) {
                sourcesRef.current.forEach(s => s.stop());
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                setIsAIResponding(false);
            }
          },
          onclose: () => {
            console.log("Live API Closed");
            setIsConnected(false);
          },
          onerror: (e) => {
            console.error("Live API Error", e);
            setError("Connection error.");
            setIsConnected(false);
          }
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (err) {
      console.error("Failed to connect", err);
      setError("Failed to access microphone or connect.");
    }
  };

  useEffect(() => {
    if (isOpen) {
      connectToLiveAPI();
    } else {
      cleanupAudio();
    }
    return () => cleanupAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden relative shadow-2xl flex flex-col items-center p-8 min-h-[400px]">
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
        >
          <X size={20} className="text-gray-600" />
        </button>

        {/* Status Indicator */}
        <div className="flex-1 flex flex-col items-center justify-center space-y-8 w-full">
          
          <div className="relative">
            {/* Pulse Animation when AI talking */}
            {isAIResponding && (
              <div className="absolute inset-0 bg-wechat-green/30 rounded-full animate-ping"></div>
            )}
            
            <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
              isAIResponding 
                ? 'bg-wechat-green shadow-[0_0_40px_rgba(7,193,96,0.6)] scale-110' 
                : isSpeaking 
                  ? 'bg-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.5)]'
                  : 'bg-gray-200'
            }`}>
              {isConnected ? (
                isAIResponding ? <Volume2 size={48} className="text-white" /> : <Mic size={48} className="text-white" />
              ) : (
                <Loader2 size={48} className="text-gray-500 animate-spin" />
              )}
            </div>
          </div>

          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-gray-800">
              {isConnected ? (isAIResponding ? "Speaking..." : (isSpeaking ? "Listening..." : "I'm listening")) : "Connecting..."}
            </h2>
            <p className="text-gray-500 text-sm max-w-[250px]">
              {isConnected 
                ? "Talk naturally about your week. I have context from your notes." 
                : "Establishing secure connection to Gemini..."}
            </p>
          </div>

          {error && (
             <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">
               {error}
             </div>
          )}
        </div>

        {/* Hangup Button */}
        <button 
          onClick={onClose}
          className="mt-8 bg-red-500 text-white px-8 py-3 rounded-full font-medium hover:bg-red-600 transition-colors shadow-lg active:scale-95 transform"
        >
          End Call
        </button>

      </div>
    </div>
  );
};

export default VoiceChatModal;
