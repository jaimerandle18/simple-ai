import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Button, CircularProgress, Dialog, DialogActions, DialogTitle, IconButton, useMediaQuery, TextField, Switch } from '@mui/material';
import Navbar from '../Home/Navbar';
import { getConversationDetails, deleteConversation, pauseConversation, resumeConversation, sendManualMessage, replyToConversation } from '../services/bffService';
import ConversationHeader from './ConversationHeader';
import MessageList from './MessageList';
import DeleteDialog from './DeleteDialog';
import ConversationContainer from './ConversationContainer';
import WhatsAppLogo from '../assets/WhatsAppLogo.svg';
import InstagramLogo from '../assets/Instagram.svg';
import MercadoLibreLogo from '../assets/mercadolibre.svg';
import Loading from '../components/Loading';
import { ConversationsTop } from './ConversationTop';
import SendIcon from '@mui/icons-material/Send';
import SimpleAI from '../assets/SimpleWhiteAI.png';
import Logo from '../assets/simpleLogo.webp';
import TitleSimple from '../components/titleSimple';

const ConversationDetails = () => {
  const isMobile = useMediaQuery('(max-width:750px)');
  const { id } = useParams();
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [manualMessage, setManualMessage] = useState(''); 
  const [manualMode, setManualMode] = useState(false); 
  const navigate = useNavigate();
  const textFieldRef = useRef(null); 
  const [lastMessageTimestamp, setLastMessageTimestamp] = useState(null);
  const token = localStorage?.getItem('authToken');
  const messagesEndRef = useRef(null);
  const [manualMessages, setManualMessages] = useState([]); 

  useEffect(() => {
    const fetchConversationDetails = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) {
        navigate('/');
      } else {
        try {
          const conversationDetails = await getConversationDetails(id, token);
          setConversation(conversationDetails);
        } catch (error) {
          setError(error.message);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchConversationDetails();
  }, [id, navigate]);

  useEffect( () => {
    async function setStatus(){
      if (await conversation?.status === 3 ){
        setManualMode(true);
      } else {
        setManualMode(false);
      }
    }
    setStatus();

    const pollMessages = async () => {
      try {
        const token = localStorage.getItem('authToken');
        const response = await getConversationDetails(id, token, lastMessageTimestamp);

        if (response.messages.length > 0) {
          const newTimestamp = response.messages[response.messages.length - 1].timestamp;
          setLastMessageTimestamp(newTimestamp);

          const newMessages = response.messages.filter(
            msg => !conversation.messages.some(existingMsg => existingMsg.timestamp === msg.timestamp) 
            && msg.from !== 'dashboard'
          );

          if (newMessages.length > 0) {
            setConversation(prev => ({
              ...prev,
              messages: [...prev.messages, ...newMessages],
            }));
          }
        }
      } catch (error) {
        console.error('Error al hacer polling:', error);
      }
    };

    const pollingInterval = setInterval(pollMessages, 5000);
    return () => clearInterval(pollingInterval); 
  }, [id, lastMessageTimestamp, conversation?.messages]);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleStateChange = (id, newState) => {
    setConversation(prevConversation => ({
      ...prevConversation,
      state: newState,
    }));

    const storedConversations = JSON.parse(sessionStorage.getItem('conversations'));
    if (storedConversations) {
      const updatedConversations = storedConversations.map(conversation =>
        conversation.id === parseInt(id)
          ? { ...conversation, state: newState }
          : conversation
      );
      sessionStorage.setItem('conversations', JSON.stringify(updatedConversations));
    }
  };

  const handleManualModeChange = async (event) => {
    const isManual = event.target.checked;
    setManualMode(isManual);

    if (isManual) {
      try {
        await pauseConversation(id, token); 
        console.log('Conversación pausada');
      } catch (error) {
        console.error('Error al pausar la conversación:', error);
      }
    } else {
      try {
        await resumeConversation(id, token); 
        console.log('Conversación reanudada');
      } catch (error) {
        console.error('Error al reanudar la conversación:', error);
      }
    }

    if (isManual && textFieldRef.current) {
      textFieldRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleManualMessageChange = (event) => {
    setManualMessage(event.target.value);
  };

  const handleSendManualMessage = async () => {
    if (manualMessage.trim() !== '') {
      try {
        const token = localStorage.getItem('authToken');
        await replyToConversation(id, { text: manualMessage }, token); 

        const newMessage = {
          text: manualMessage,
          from: 'dashboard',
          timestamp: new Date().toISOString(),
        };

        setConversation(prevConversation => ({
          ...prevConversation,
          messages: [...prevConversation?.messages, newMessage],
        }));

        setManualMessages(prev => [...prev, newMessage]);
        setManualMessage('');
        scrollToBottom();
      } catch (error) {
        console.error('Error al enviar el mensaje manual:', error.message);
      }
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Loading />
      </Box>
    );
  }

  if (error) {
    return <Typography>{error}</Typography>;
  }

  if (!conversation) {
    return <Typography>No se encontró la conversación.</Typography>;
  }

  let logoSrc;
  let canal;
  switch (conversation.channel_type) {
    case 3:
      logoSrc = MercadoLibreLogo;
      canal = 'MELI';
      break;
    case 4:
    case 1:
    case 6:
      logoSrc = WhatsAppLogo;
      canal = 'WhatsApp';
      break;
    default:
      logoSrc = WhatsAppLogo;
      canal = 'WhatsApp';
  }

  return (
    <div className={isMobile ? "ALL" : ""} style={{ 
      height: '100vh', // Asegúrate de que ocupe toda la altura de la pantalla
      display: 'flex',
      flexDirection: isMobile ? 'column-reverse' : 'column',
      overflow: 'hidden' // Evita scroll en el contenedor principal
    }}>
      <Navbar />
      <div style={{ width:isMobile?"100%":"90%",marginLeft:isMobile?"" :"5%",height: isMobile ? "calc(100% - 80px)" : "100%" ,zIndex:isMobile?"2":"",  overflow: 'hidden'}}>
        <ConversationContainer canal={canal} style={{ backgroundColor: "white",height:"100%",borderRadius:isMobile?"10px 10px 0px 0px":"",overflow: 'hidden'}}>
          <ConversationsTop canal={canal} logoSrc={logoSrc} style={{ backgroundColor: "white" }} />
          <div style={{ border: "0.3px solid #E1C9FF", zIndex: "1111", marginTop: "20px" }}></div>
          {
            !isMobile?
            <Box sx={{ marginTop: 2, display: 'flex', alignItems: 'center' }}>
            <Typography sx={{ marginRight: 2, marginLeft:2 }}>Modo IA</Typography>
            <Switch checked={manualMode} onChange={handleManualModeChange} />
            <Typography sx={{ marginLeft: 2 }}>Modo Manual</Typography>
          </Box>
            :
            <></>
          }
          <div style={{ display: isMobile ? "block" : "flex", backgroundColor: "white" , overflow:"auto"}}>
            <ConversationHeader conversation={conversation} id={id} isMobile={isMobile} onStateChange={handleStateChange} canal={canal} logoSrc={logoSrc} />
            <MessageList conversation={conversation} isManual={manualMode} />
          </div>

          {manualMode && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'right',
                padding: '10px',
                borderRadius: '10px',
                marginTop: 2,
                width: "100%",
                justifyContent:"flex-end"
              }}
              ref={textFieldRef} 
            >
              <TextField
                fullWidth
                placeholder="Escribe un mensaje..."
                value={manualMessage}
                onChange={handleManualMessageChange}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault(); 
                    handleSendManualMessage();
                  }
                }}
                variant="outlined"
                multiline
                style={{width:"65%", display:"flex", justifyContent:"flex-end"}}
                maxRows={4}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    padding: '8px 10px',
                    borderRadius: '10px',
                    backgroundColor: 'white',
                  },
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'grey',
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'grey',
                  },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'transparent',
                  },
                }}
              />
              <IconButton
                color="primary"
                onClick={handleSendManualMessage}
                sx={{
                  marginLeft: '10px',
                  alignSelf:"center",
                  height:"40px",
                  width:"4%",
                  backgroundColor: '#25d366',
                  '&:hover': {
                    backgroundColor: '#22b358',
                  },
                }}
              >
                <SendIcon sx={{ color: 'white',  width:"100%" }} />
              </IconButton>
            </Box>
          )}
        </ConversationContainer>
      </div>
      {isMobile?
        <>
          
          <div onClick={()=>navigate('/home')} style={{zIndex:"2", margin:"auto",display:"flex",alignItems:"center",marginTop: isMobile? "5%" :"19%", gap:"20px",marginBottom:isMobile? "5%" :"10%"}}>
            <img src={Logo}  style={{width:isMobile? "22%" : "30%"}}/>
            <img src={SimpleAI} style={{width:isMobile? "60%":"90%"}}/>
          </div>
        
        </>
        :
        <></>
      }
   
    </div>
  );
};

export default ConversationDetails;