import React, { useState, useEffect, useRef } from 'react';
import './chatPrueba.css';
import Navbar from '../Home/Navbar';
import { Box, Button, useMediaQuery } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import Header from './header';
import ChatBox from './chatBox';
import AssistantBox from './assistantBox';
import ConfirmationDialog from './confirmationDialog';
import { getAssistants, getUserInfo, updateAssistant, getChannels } from '../services/bffService';
import Loading from '../components/Loading';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import SimpleAI from '../assets/SimpleWhiteAI.png';
import Logo from '../assets/simpleLogo.webp';
import { MobileHeader } from '../components/mobileHeader';
import { POLLING_BASE_URL, WEBHOOK_URL } from '../constants';

function ChatPrueba() {
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState({});
  const [input, setInput] = useState('');
  const [dates, setDates] = useState("");
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantName, setAssistantName] = useState('');
  const [assistants, setAssistants] = useState([]);
  const [selectedAssistant, setSelectedAssistant] = useState(null);
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState(null);
  const [isModified, setIsModified] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [pendingAssistant, setPendingAssistant] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const isMobile = useMediaQuery('(max-width:600px)');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadingSendPrompt, setLoadingSendPrompt] = useState(false);
  const [source, setSource] = useState("");
  const messagesEndRef = useRef(null);
  const [openSnack, setOpenSnack] = useState(false);
  const [openSnackError, setOpenSnackError] = useState(false);

  const generateConversationId = () => {
    return String(Date.now()) + Math.floor(Math.random() * 999999);
  };

  useEffect(() => {
    setSource(generateConversationId());
  }, []);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const startNewConversation = () => {
    if (selectedAssistant) {
      setConversations((prevConversations) => ({
        ...prevConversations,
        [selectedAssistant.id]: [],
      }));
      setMessages([]);
      setSource(generateConversationId());
      setIsTyping(false);
    }
  };

  useEffect(() => {
    const fetchInitialData = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) {
        navigate('/');
        return;
      }
      try {
        const assistantsData = await getAssistants(token);
        setAssistants(assistantsData);

        const clientInfo = await getUserInfo(token);
        setClientId(clientInfo.client_id);

        const channelsData = await getChannels(token);
        setChannels(channelsData);

        if (assistantsData.length > 0) {
          const initialAssistant = assistantsData[0];
          setSelectedAssistant(initialAssistant);
          setAssistantInput(initialAssistant.config?.extraPrompt || '');
          setAssistantName(initialAssistant.name);

          const initialChannel = channelsData.find(channel => channel.assistant_id === initialAssistant.id && channel.type === 6);
          setChannelId(initialChannel ? initialChannel.id : null);
        }

        setLoading(false);
      } catch (error) {
        console.error("Error fetching initial data", error);
        setLoading(false);
      }
    };
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (!selectedAssistant) {
      setAssistantInput('');
      setAssistantName('');
      setChannelId(null);
      setIsModified(false);
    }
  }, [selectedAssistant, channels]);


  const handlePromptChange = (e) => {
    setAssistantInput(e.target.value);
    setIsModified(true);
  };

  const performAssistantChange = (assistantToSelect) => {
    if (selectedAssistant) {
      setConversations((prevConversations) => ({
        ...prevConversations,
        [selectedAssistant.id]: messages,
      }));
    }

    setSelectedAssistant(assistantToSelect);
    setAssistantInput(assistantToSelect.config?.extraPrompt || '');
    setAssistantName(assistantToSelect.name);
    setIsModified(false);

    const newMessages = conversations[assistantToSelect.id] || [];
    setMessages(newMessages);
    setSource(generateConversationId());
    setIsTyping(false);

    const newAssistantChannel = channels.find(channel => channel.assistant_id === assistantToSelect.id && channel.type === 6);
    if (newAssistantChannel) {
      setChannelId(newAssistantChannel.id);
    } else {
      setChannelId(null);
    }
  };

  const handleAssistantChange = (newAssistant) => {
    if (isModified || messages.length > 0) {
      setPendingAssistant(newAssistant);
      setShowConfirmation(true);
    } else {
      performAssistantChange(newAssistant);
    }
  };

  const confirmAssistantChange = async () => {
    if (pendingAssistant) {
      try {
        const token = localStorage.getItem('authToken');
        const assistantsData = await getAssistants(token);
        setAssistants(assistantsData);

        const updatedAssistantRef = assistantsData.find(assistant => assistant.id === pendingAssistant.id);

        if (updatedAssistantRef) {
            performAssistantChange(updatedAssistantRef);
        } else {
            console.error('Error: Pending assistant not found in updated list after confirmation.');
            setSelectedAssistant(null);
            setAssistantInput('');
            setAssistantName('');
            setChannelId(null);
            setMessages([]);
        }

        setShowConfirmation(false);
        setPendingAssistant(null);
      } catch (error) {
        console.error('Error confirming assistant change or loading data:', error);
        setShowConfirmation(false);
        setPendingAssistant(null);
        setOpenSnackError(true);
      }
    }
  };

  const sendMessage = async () => {
    if (input.trim() === '' || !selectedAssistant || !channelId) {
      return;
    }
    const eventId = String(Date.now()) + Math.floor(Math.random() * 999999);

    const newMessage = {
      id: eventId,
      clientId: clientId,
      channelId: channelId,
      source: source,
      target: selectedAssistant.name,
      text: input,
    };

    setMessages((prevMessages) => [...prevMessages, { user: 'CLIENTE', text: input, timestamp: new Date() }]);

    try {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMessage),
      });

      setInput('');
      setIsTyping(true);
      setTimeout(() => startPolling(eventId), 10000);
    } catch (error) {
      console.error('Error sending message:', error);
      setIsTyping(false);
    }
  };

  const startPolling = async (eventId) => {
    const pollingUrl = `${POLLING_BASE_URL}${eventId}`;
    let attempts = 0;
    const maxAttempts = 10;

    const poll = async () => {
      try {
        const response = await fetch(pollingUrl);
        const result = await response.json();

        if (result.action === 'SKIP') {
          setIsTyping(false);
        } else if (result.action === 'WAIT') {
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(poll, 1000);
          } else {
            console.warn(`Max polling attempts reached for event ${eventId}.`);
            setIsTyping(false);
          }
        } else if (result.action === 'REPLY') {
          const replyMessages = result?.text
            ? [{ type: 'textWap', body: result.text }]
            : result.messages || [];

          replyMessages.forEach((replyMessage) => {
            let formattedMessage = '';

            if (replyMessage.type === 'textWap') {
              formattedMessage = replyMessage.body;
            } else if (replyMessage.type === 'text') {
              formattedMessage = `<p>${replyMessage.text.body}</p>`;
            } else if (replyMessage.type === 'image') {
              formattedMessage = `
                <div>
                  <img src="${replyMessage.image.link}" alt="${replyMessage.image.caption || 'Imagen'}" style="max-width: 100%; height: auto;">
                  ${replyMessage.image.caption ? `<p style="font-weight: bold;">${replyMessage.image.caption}</p>` : ''}
                </div>`;
            } else if (replyMessage.type === 'document') {
              formattedMessage = `<a href="${replyMessage.document.url}" target="_blank" rel="noopener noreferrer">${replyMessage.document.caption || 'Document'}</a>`;
            } else {
                console.warn("Unknown message type:", replyMessage.type);
                formattedMessage = `Unknown message type: ${JSON.stringify(replyMessage)}`;
            }

            setMessages((prevMessages) => [
              ...prevMessages,
              { user: selectedAssistant?.name, text: formattedMessage, timestamp: new Date() },
            ]);
          });

          setIsTyping(false);
        }
      } catch (error) {
        console.error('Error during polling:', error);
        setIsTyping(false);
      }
    };
    poll();
  };

  const sendPromptToAssistant = async () => {
    setLoadingSendPrompt(true);
    if (assistantInput.trim() && selectedAssistant) {
        const token = localStorage.getItem('authToken');
        try {
            const updatedAssistantData = {
                ...selectedAssistant,
                config: {
                    ...selectedAssistant.config,
                    extraPrompt: assistantInput,
                },
            };

            await updateAssistant(selectedAssistant.id, updatedAssistantData, token);

            const assistantsData = await getAssistants(token);
            setAssistants(assistantsData);

            const refreshedAssistant = assistantsData.find(assistant => assistant.id === selectedAssistant.id);

            if (refreshedAssistant) {
                setSelectedAssistant(refreshedAssistant);
                setAssistantInput(refreshedAssistant.config?.extraPrompt || '');
                setAssistantName(refreshedAssistant.name);
            } else {
                console.warn("Updated assistant not found in refreshed list. Possible inconsistency.");
            }

            setIsModified(false);
            setOpenSnack(true);
        } catch (error) {
            console.error('Error updating assistant:', error);
            setOpenSnackError(true);
        } finally {
            setLoadingSendPrompt(false);
        }
    }
  };

  return (
      <div className={isMobile?'asistContainer':""} style={{ height: '100vh', overflowY: 'auto', display:isMobile?"flex":"",flexDirection:isMobile?"column-reverse":"none"}}>
        <Navbar />
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
            <Loading />
          </Box>
        ) : (
          <div className="playground-container" style={{zIndex:isMobile?"1":"", width:isMobile?"100%":"",borderRadius:isMobile?"10px 10px 0px 0px":""}}>
            <Header
              assistants={assistants}
              selectedAssistant={selectedAssistant}
              onAssistantChange={handleAssistantChange}
              isMobile={isMobile}
              navigate={navigate}
              startNewConversation={startNewConversation}
            />
            <div style={{ display: 'flex', width:isMobile? '90%':'100%', justifyContent: 'space-between',flexDirection:isMobile?"column":"",height:isMobile?"60%":"70%"}}>
                <div style={{flex:isMobile?"1":"2",display:'flex'}}>
                <ChatBox
                  messages={messages}
                  input={input}
                  setInput={setInput}
                  onSend={sendMessage}
                  isTyping={isTyping}
                  assistantName={assistantName}
                  messagesEndRef={messagesEndRef}
                />
                </div>

                <div style={{flex:"1",display:"flex"}}>
                <AssistantBox
                    key={selectedAssistant?.id || 'no-assistant'}
                    assistantInput={assistantInput}
                    onPromptChange={handlePromptChange}
                    onSend={sendPromptToAssistant}
                    loading={loadingSendPrompt}
                  />

                </div>
            </div>
            <ConfirmationDialog
              open={showConfirmation}
              onConfirm={confirmAssistantChange}
              onCancel={() => setShowConfirmation(false)}
              assistantName={pendingAssistant?.name}
            />
            <Snackbar
              open={openSnack}
              autoHideDuration={3500}
              onClose={() => setOpenSnack(false)}
            >
              <Alert onClose={() => setOpenSnack(false)} severity="success">
                Tu asistente de {assistantName} se actualizó correctamente!
              </Alert>
            </Snackbar>
            <Snackbar
              open={openSnackError}
              autoHideDuration={3500}
              onClose={() => setOpenSnackError(false)}
            >
              <Alert onClose={() => setOpenSnackError(false)} severity="error">
                Tu asistente de {assistantName} no se pudo actualizar
              </Alert>
            </Snackbar>
          </div>
        )}
        {isMobile?
       <MobileHeader/>
        :
        <></>
      }
      </div>
  );
}

export default ChatPrueba;