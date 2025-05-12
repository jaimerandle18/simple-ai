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
  const [extraPrompt, setExtraPrompt] = useState('');
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
    setConversations((prevConversations) => ({
      ...prevConversations,
      [selectedAssistant.id]: [],
    }));
    setMessages([]);
    setSource(generateConversationId());
    setIsTyping(false);
  };

  useEffect(() => {
    const fetchAssistantData = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) {
        navigate('/');
        return;
      }
      try {
        const assistantsData = await getAssistants(token);
        setAssistants(assistantsData);
        setSelectedAssistant(assistantsData[0]);
        setAssistantName(assistantsData[0].name);
        setExtraPrompt(assistantsData[0].config.extraPrompt || '');
        setAssistantInput(assistantsData[0].config.extraPrompt || '');

        const clientInfo = await getUserInfo(token);
        setClientId(clientInfo.client_id);

        const channelsData = await getChannels(token);
        setChannels(channelsData);

        const initialChannel = channelsData.find(channel => channel.assistant_id === assistantsData[0].id && channel.type === 6);
        if (initialChannel) {
          setChannelId(initialChannel.id);
        }

        setLoading(false);
      } catch (error) {
        console.error("Error fetching data", error);
        setLoading(false);
      }
    };
    fetchAssistantData();
  }, []);

  const handlePromptChange = (e) => {
    setAssistantInput(e.target.value);
    setIsModified(true);
  };

  const handleAssistantChange = (newAssistant) => {
    if (isModified || messages.length > 0) {
      setPendingAssistant(newAssistant);
      setShowConfirmation(true);
    } else {
      setConversations((prevConversations) => ({
        ...prevConversations,
        [selectedAssistant.id]: messages,
      }));
      const newMessages = conversations[newAssistant.id] || [];
      setMessages(newMessages);
      setSelectedAssistant(newAssistant);
      setAssistantName(newAssistant.name);
      setExtraPrompt(newAssistant.config.extraPrompt || '');
      setAssistantInput(newAssistant.config.extraPrompt || '');

      const assistantChannel = channels.find(channel => channel.assistant_id === newAssistant.id && channel.type === 6);
      if (assistantChannel) {
        setChannelId(assistantChannel.id);
      }

      setSource(generateConversationId()); 
      setIsTyping(false);
    }
  };
const confirmAssistantChange = async () => {
  if (pendingAssistant) {
    // Guarda la conversación actual antes de cambiar de asistente
    setConversations((prevConversations) => ({
      ...prevConversations,
      [selectedAssistant.id]: messages,
    }));

    try {
      const token = localStorage.getItem('authToken');

      // Obtiene la lista de asistentes actualizada después del cambio
      const assistantsData = await getAssistants(token);
      setAssistants(assistantsData);

      // Busca el asistente actualizado en la lista y selecciona el nuevo
      const updatedAssistant = assistantsData.find(assistant => assistant.id === pendingAssistant.id);

      // Obtiene los canales y selecciona el canal de tipo 6 del nuevo asistente
      const channels = await getChannels(token);
      const assistantChannel = channels.find(channel => 
        channel.assistant_id === pendingAssistant.id && channel.type === 6
      );

      if (assistantChannel) {
        setChannelId(assistantChannel.id);
      } else {
        console.error('No se encontró un canal de tipo 6 para el asistente seleccionado');
      }

      // Actualiza los datos del asistente seleccionado y su conversación
      setSelectedAssistant(updatedAssistant);
      setAssistantName(updatedAssistant.name);
      setExtraPrompt(updatedAssistant.config.extraPrompt || '');
      setAssistantInput(updatedAssistant.config.extraPrompt || '');
      const newMessages = conversations[pendingAssistant.id] || [];
      setMessages(newMessages);
      setSource(generateConversationId());
      setIsTyping(false);

      // Limpia el estado de cambio pendiente y cierra el modal
      setShowConfirmation(false);
      setPendingAssistant(null);
      setIsModified(false);

    } catch (error) {
      console.error('Error al actualizar o cargar el asistente o el canal:', error);
    }
  }
};



  const sendMessage = async () => {
    if (input.trim() !== '') {
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
        console.error('Error enviando el mensaje:', error);
      }
    }
  };

  const startPolling = async (eventId) => {
    const pollingUrl = `${POLLING_BASE_URL}${eventId}`;
  
    try {
      const response = await fetch(pollingUrl);
      const result = await response.json();
  
      if (result.action === 'SKIP') {
        console.log('Mensaje combinado con otro, no se muestra.');
        setIsTyping(false);
      } else if (result.action === 'WAIT') {
        setTimeout(() => startPolling(eventId), 1000);
      } else if (result.action === 'REPLY') {
        const replyMessages = result?.text
          ? [{ type: 'textWap', body: result.text }]
          : result.messages || [];
  
        replyMessages.forEach((replyMessage) => {
          let formattedMessage;
  
          if (replyMessage.type === 'textWap') {
            formattedMessage = replyMessage.body;
          } else if (replyMessage.type === 'text') {
            formattedMessage = `<p>${replyMessage.text.body}</p>`;
          } else if (replyMessage.type === 'image') {
            formattedMessage = `
              <div>
                <img src="${replyMessage.image.link}" alt="${replyMessage.image.caption || 'Imagen'}">
                ${replyMessage.image.caption ? `<p style="font-weight: bold;">${replyMessage.image.caption}</p>` : ''}
              </div>`;
          } else if (replyMessage.type === 'document') {
            formattedMessage = `<a href="${replyMessage.document.url}" target="_blank">${replyMessage.document.caption || 'Documento'}</a>`;
          }
  
          setMessages((prevMessages) => [
            ...prevMessages,
            { user: selectedAssistant.name, text: formattedMessage, timestamp: new Date() }, 
          ]);
        });
  
        setIsTyping(false);
      }
    } catch (error) {
      console.error('Error durante el polling:', error);
      setIsTyping(false);
    }
  };

  const sendPromptToAssistant = async () => {
    setLoadingSendPrompt(true);
    if (assistantInput.trim() && selectedAssistant) {
        const token = localStorage.getItem('authToken');
        try {
            const updatedAssistant = {
                ...selectedAssistant,
                config: {
                    ...selectedAssistant.config,
                    extraPrompt: assistantInput,
                },
            };

            // Realiza el PUT para actualizar el prompt sin usar ETag
            await updateAssistant(selectedAssistant.id, updatedAssistant, token);

            // Vuelve a obtener la lista de asistentes para asegurar la sincronización
            const assistantsData = await getAssistants(token);
            setAssistants(assistantsData);

            // Encuentra y sincroniza el asistente actualizado
            const refreshedAssistant = assistantsData.find(assistant => assistant.id === selectedAssistant.id);
            setSelectedAssistant(refreshedAssistant);
            setExtraPrompt(refreshedAssistant.config.extraPrompt || '');
            setAssistantInput(refreshedAssistant.config.extraPrompt || '');

            setOpenSnack(true);
            setIsModified(false);
        } catch (error) {
            console.error('Error actualizando el asistente:', error);
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
            <div style={{ display: 'flex', width:isMobile? '90%':'100%', justifyContent: 'space-between',flexDirection:isMobile?"column":"",height:isMobile?"60%":"70%" }}>
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