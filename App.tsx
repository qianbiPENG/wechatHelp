import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Mic, 
  Lightbulb, 
  BookOpen, 
  MessageCircle, 
  FileText, 
  ArrowLeft,
  Sparkles,
  MoreHorizontal,
  Paperclip,
  X,
  ExternalLink,
  Video,
  Image as ImageIcon,
  AudioLines,
  Keyboard,
  StopCircle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { classifyContent, generateWeeklyReport } from './services/geminiService';
import { NoteItem, NoteType, ViewMode } from './types';
import VoiceChatModal from './components/VoiceChatModal';
import { arrayBufferToBase64 } from './utils/audioUtils';

function App() {
  // State
  const [inputText, setInputText] = useState('');
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.FEED);
  const [weeklyReport, setWeeklyReport] = useState<string>('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isVoiceChatOpen, setIsVoiceChatOpen] = useState(false);
  
  // Media Upload State
  const [selectedFile, setSelectedFile] = useState<{data: string, mimeType: string, preview: string, type: 'image' | 'video'} | null>(null);
  
  // Voice Note State
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem('wechat-assistant-notes');
    if (saved) {
      try {
        setNotes(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load notes", e);
      }
    }
    
    const savedReport = localStorage.getItem('wechat-assistant-report');
    if (savedReport) setWeeklyReport(savedReport);
  }, []);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem('wechat-assistant-notes', JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem('wechat-assistant-report', weeklyReport);
  }, [weeklyReport]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      const isVideo = file.type.startsWith('video/');
      
      setSelectedFile({
        data: base64Data,
        mimeType: file.type,
        preview: base64String,
        type: isVideo ? 'video' : 'image'
      });
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be selected again if needed
    e.target.value = '';
  };

  const clearAttachment = () => {
    setSelectedFile(null);
  };

  // --- Voice Note Logic ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' }); // Chrome/Firefox default
        await handleSendAudio(audioBlob);
        
        // Stop all tracks
        mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
      };
      mediaRecorderRef.current.stop();
    }
  };

  const handleSendAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64Data = arrayBufferToBase64(arrayBuffer);
      
      // Send audio as media to Gemini
      const result = await classifyContent('', {
        mimeType: audioBlob.type || 'audio/webm',
        data: base64Data
      });

      const newNote: NoteItem = {
        id: Date.now().toString(),
        content: result.content || "(Audio Note)", // The transcribed text
        type: result.type,
        title: result.title,
        summary: result.summary,
        createdAt: Date.now(),
        sourceUrl: result.sourceUrl,
        media: { // Store audio for playback in feed if needed, or we can just keep text. Let's keep audio.
            mimeType: audioBlob.type || 'audio/webm',
            data: base64Data
        }
      };

      setNotes(prev => [newNote, ...prev]);
    } catch (error) {
      console.error("Audio processing failed", error);
      alert("Failed to transcribe audio.");
    } finally {
      setIsProcessing(false);
    }
  };
  // ------------------------

  const handleSend = async () => {
    if (!inputText.trim() && !selectedFile) return;
    
    setIsProcessing(true);
    try {
      // Prepare media object if exists
      const mediaPayload = selectedFile ? {
        mimeType: selectedFile.mimeType,
        data: selectedFile.data
      } : undefined;

      // AI Classification
      const result = await classifyContent(inputText, mediaPayload);
      
      const newNote: NoteItem = {
        id: Date.now().toString(),
        content: result.content || inputText, // Use extracted text/desc or input
        type: result.type,
        title: result.title,
        summary: result.summary,
        createdAt: Date.now(),
        sourceUrl: result.sourceUrl,
        media: mediaPayload // Store media for display
      };

      setNotes(prev => [newNote, ...prev]);
      setInputText('');
      setSelectedFile(null);
      
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (error) {
      console.error("Processing failed", error);
      alert("Failed to process content. Check console.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateReport = async () => {
    if (notes.length === 0) return;
    setIsGeneratingReport(true);
    setViewMode(ViewMode.REPORT);
    try {
      const report = await generateWeeklyReport(notes);
      setWeeklyReport(report);
    } catch (error) {
      console.error("Report generation failed", error);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const getIconForType = (type: NoteType) => {
    switch (type) {
      case NoteType.THOUGHT: return <Lightbulb size={18} className="text-yellow-500" />;
      case NoteType.ARTICLE: return <BookOpen size={18} className="text-blue-500" />;
      case NoteType.CHAT: return <MessageCircle size={18} className="text-green-500" />;
      default: return <FileText size={18} className="text-gray-500" />;
    }
  };

  const getColorForType = (type: NoteType) => {
    switch (type) {
      case NoteType.THOUGHT: return 'bg-yellow-50 text-yellow-700 border-yellow-100';
      case NoteType.ARTICLE: return 'bg-blue-50 text-blue-700 border-blue-100';
      case NoteType.CHAT: return 'bg-green-50 text-green-700 border-green-100';
      default: return 'bg-gray-50 text-gray-700 border-gray-100';
    }
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  return (
    <div className="min-h-screen bg-[#F2F2F2] flex flex-col max-w-lg mx-auto shadow-2xl overflow-hidden font-sans">
      
      {/* Header */}
      <header className="bg-white px-4 py-3 sticky top-0 z-10 border-b border-gray-100 flex justify-between items-center shadow-sm">
        <div className="flex items-center space-x-3">
          {viewMode === ViewMode.REPORT && (
            <button onClick={() => setViewMode(ViewMode.FEED)} className="p-1 hover:bg-gray-100 rounded-full">
              <ArrowLeft size={20} className="text-gray-600" />
            </button>
          )}
          <h1 className="text-lg font-bold text-gray-800">
            {viewMode === ViewMode.FEED ? 'WeChat Assistant' : 'Weekly Insight'}
          </h1>
        </div>
        <div className="flex space-x-2">
           {viewMode === ViewMode.FEED && (
             <>
               {/* Summary Button in Header (Optional duplicate) */}
               {notes.length > 0 && (
                <button 
                  onClick={handleGenerateReport}
                  className="md:flex hidden text-xs font-semibold bg-wechat-green text-white px-3 py-1.5 rounded-full hover:bg-green-600 transition-colors items-center space-x-1"
                >
                  <Sparkles size={14} />
                  <span>Summary</span>
                </button>
               )}
               {/* Voice Chat (Live) Button in Header now */}
               <button 
                onClick={() => setIsVoiceChatOpen(true)}
                className="p-1.5 rounded-full bg-gray-100 text-gray-600 hover:text-wechat-green transition-colors"
                title="Live Voice Call"
               >
                 <Mic size={18} />
               </button>
             </>
           )}
           <button className="p-2 hover:bg-gray-100 rounded-full text-gray-600">
             <MoreHorizontal size={20} />
           </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 no-scrollbar pb-40">
        
        {viewMode === ViewMode.FEED ? (
          <div className="space-y-4">
            {notes.length === 0 && (
              <div className="text-center text-gray-400 mt-20 flex flex-col items-center">
                 <div className="bg-gray-200 p-4 rounded-full mb-4">
                   <Send size={32} className="text-gray-400" />
                 </div>
                 <p className="text-sm">Paste text, links, voice notes, or media.</p>
                 <p className="text-xs mt-2 text-gray-300">AI automatically organizes everything.</p>
              </div>
            )}
            
            {notes.map((note) => (
              <div key={note.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-50 transition-all hover:shadow-md">
                <div className="flex items-start justify-between mb-2">
                  <div className={`flex items-center space-x-2 px-2 py-1 rounded-md text-xs font-medium ${getColorForType(note.type)}`}>
                    {getIconForType(note.type)}
                    <span className="capitalize">{note.type}</span>
                  </div>
                  <span className="text-xs text-gray-300">
                    {new Date(note.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </span>
                </div>
                
                <h3 className="font-bold text-gray-800 mb-1 line-clamp-1">{note.title}</h3>
                
                {/* Media Display */}
                {note.media && (
                  <div className="mb-3 mt-2 rounded-lg overflow-hidden bg-black/5 border border-gray-100">
                    {note.media.mimeType.startsWith('video/') ? (
                      <video 
                        src={`data:${note.media.mimeType};base64,${note.media.data}`} 
                        controls 
                        className="w-full h-auto max-h-60 object-contain"
                      />
                    ) : note.media.mimeType.startsWith('audio/') ? (
                      <div className="p-3 bg-gray-100 flex items-center justify-center">
                         <audio 
                           src={`data:${note.media.mimeType};base64,${note.media.data}`} 
                           controls 
                           className="w-full"
                         />
                      </div>
                    ) : (
                      <img 
                        src={`data:${note.media.mimeType};base64,${note.media.data}`} 
                        alt="attachment" 
                        className="w-full h-auto max-h-60 object-cover"
                      />
                    )}
                  </div>
                )}

                {note.content && (
                  <p className="text-sm text-gray-600 mb-3 line-clamp-3 leading-relaxed whitespace-pre-wrap">{note.content}</p>
                )}

                {/* Footer: Summary & Source Link */}
                <div className="flex flex-col space-y-2">
                  <div className="text-xs text-gray-400 bg-gray-50 p-2 rounded-lg italic">
                    AI Summary: {note.summary}
                  </div>
                  
                  {note.sourceUrl && (
                    <a 
                      href={note.sourceUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center space-x-1 text-xs text-blue-500 hover:underline w-fit"
                    >
                      <ExternalLink size={10} />
                      <span>Original Source</span>
                    </a>
                  )}
                </div>
              </div>
            ))}

            {/* Bottom Button for Generate Report - Always Visible */}
            <div className="pt-4 pb-8">
               <button 
                 onClick={handleGenerateReport}
                 disabled={notes.length === 0}
                 className={`w-full group py-3 rounded-xl font-bold transition-all shadow-sm flex items-center justify-center space-x-2 ${
                   notes.length > 0 
                    ? 'bg-white border border-wechat-green text-wechat-green hover:bg-wechat-green hover:text-white cursor-pointer' 
                    : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                 }`}
               >
                 <Sparkles size={20} className={notes.length > 0 ? "group-hover:animate-pulse" : ""} />
                 <span>{notes.length > 0 ? "Generate Weekly Report" : "Add Content to Generate Report"}</span>
               </button>
               {notes.length > 0 && (
                 <p className="text-center text-xs text-gray-400 mt-2">
                   Summarizes {notes.length} items into a formatted weekly review.
                 </p>
               )}
            </div>
          </div>
        ) : (
          /* Report View */
          <div className="bg-white rounded-2xl p-6 shadow-sm min-h-full">
            {isGeneratingReport ? (
              <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <Sparkles className="animate-spin text-wechat-green" size={32} />
                <p className="text-gray-500 text-sm">Analyzing articles, videos, and chats...</p>
              </div>
            ) : (
              <div className="prose prose-sm prose-green max-w-none">
                 <ReactMarkdown 
                    components={{
                      a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" />
                    }}
                 >
                   {weeklyReport}
                 </ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom Input Area */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-3 max-w-lg mx-auto z-20">
        
        {/* Attachment Preview */}
        {selectedFile && (
           <div className="mb-2 flex items-center bg-gray-100 rounded-lg p-2 relative w-fit pr-8">
             {selectedFile.type === 'video' ? <Video size={16} className="text-gray-500 mr-2"/> : <ImageIcon size={16} className="text-gray-500 mr-2"/>}
             <span className="text-xs text-gray-600 max-w-[200px] truncate">Attached Media</span>
             <button 
               onClick={clearAttachment}
               className="absolute right-1 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded-full"
             >
               <X size={14} className="text-gray-500" />
             </button>
           </div>
        )}

        <div className="flex items-end space-x-2 bg-gray-100 rounded-2xl p-2 relative">
          
          {/* Voice Mode Toggle (Like WeChat) */}
          <button 
            onClick={() => setIsVoiceMode(!isVoiceMode)}
            className="p-2.5 rounded-full text-gray-600 hover:bg-white hover:shadow-sm transition-all"
          >
            {isVoiceMode ? <Keyboard size={20} /> : <AudioLines size={20} />}
          </button>

          {isVoiceMode ? (
            /* Voice Recording Button */
            <button
               className={`flex-1 font-medium text-sm py-2.5 rounded-xl transition-all select-none ${
                 isRecording 
                   ? 'bg-wechat-green text-white shadow-inner animate-pulse' 
                   : 'bg-white text-gray-800 shadow-sm hover:bg-gray-50'
               }`}
               onMouseDown={startRecording}
               onMouseUp={stopRecording}
               onTouchStart={startRecording}
               onTouchEnd={stopRecording}
            >
              {isRecording ? (
                 <span className="flex items-center justify-center space-x-2">
                   <span className="w-2 h-2 bg-white rounded-full animate-bounce"></span>
                   <span>Release to Send</span>
                 </span>
              ) : (
                 "Hold to Record"
              )}
            </button>
          ) : (
            /* Text Input */
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleInput}
              placeholder="Message..."
              className="flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-32 py-2.5 text-sm text-gray-800 placeholder-gray-400"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
          )}

          {!isVoiceMode && (
            <>
              <input 
                type="file" 
                ref={fileInputRef}
                className="hidden" 
                accept="image/*,video/*"
                onChange={handleFileSelect}
              />
              
              <button 
                onClick={() => fileInputRef.current?.click()}
                className={`p-2.5 rounded-full shadow-sm transition-colors active:scale-95 flex-shrink-0 ${selectedFile ? 'bg-blue-100 text-blue-600' : 'bg-white text-gray-600 hover:text-blue-500'}`}
                title="Attach"
              >
                <Paperclip size={20} />
              </button>

              <button 
                onClick={handleSend}
                disabled={(!inputText.trim() && !selectedFile) || isProcessing}
                className={`p-2.5 rounded-full shadow-sm transition-all duration-200 flex-shrink-0 ${
                  (inputText.trim() || selectedFile) 
                    ? 'bg-wechat-green text-white hover:bg-green-600 active:scale-95' 
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isProcessing ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Send size={20} className={(inputText.trim() || selectedFile) ? "translate-x-0.5" : ""} />
                )}
              </button>
            </>
          )}
        </div>
        
        {isVoiceMode && (
           <div className="text-center mt-2 h-4">
              {isRecording && <span className="text-xs text-wechat-green font-medium">Recording...</span>}
           </div>
        )}
      </div>

      {/* Voice Chat Modal (Live) */}
      <VoiceChatModal 
        isOpen={isVoiceChatOpen} 
        onClose={() => setIsVoiceChatOpen(false)} 
        notes={notes}
      />

    </div>
  );
}

export default App;