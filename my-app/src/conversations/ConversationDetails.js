import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Button, CircularProgress, Dialog, DialogActions, DialogTitle, IconButton, useMediaQuery, TextField, Switch } from '@mui/material';
import Navbar from '../Home/Navbar';
import { getConversationDetails, pauseConversation, resumeConversation, replyToConversation, updateConversationMetadata } from '../services/bffService';
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
import { Grid } from '@mui/material';


const ConversationDetails = () => {
  const isMobile = useMediaQuery('(max-width:750px)');
  const { id } = useParams();
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [manualMessage, setManualMessage] = useState('');
  const [manualMode, setManualMode] = useState(false);  // Modo Manual
  const [copilotMode, setCopilotMode] = useState(false);  // Modo Copilot
  const [suggestedReply, setSuggestedReply] = useState(''); // Respuesta sugerida por Copilot
  const textFieldRef = useRef(null);
  const navigate = useNavigate();
  const token = localStorage?.getItem('authToken');

  useEffect(() => {
    const fetchConversationDetails = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) {
        navigate('/');
      } else {
        try {
          const conversationDetails = await getConversationDetails(id, token);
          setConversation(conversationDetails);
          setCopilotMode(conversationDetails.copilotEnabled || false);
          setSuggestedReply(conversationDetails.suggestedReply || ''); // Cargar la respuesta sugerida
        } catch (error) {
          setError(error.message);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchConversationDetails();
  }, [id, navigate]);

  const handleCopilotModeChange = async (event) => {
    if (!manualMode) return; // Deshabilitar Copilot si no está activado el Modo Manual
    const isCopilot = event.target.checked;
    setCopilotMode(isCopilot);

    try {
      const token = localStorage.getItem('authToken');
      await updateConversationMetadata(id, { copilotEnabled: isCopilot }, token); 
      
      if (isCopilot) {
        const conversationDetails = await getConversationDetails(id, token);
        setSuggestedReply(conversationDetails.suggestedReply || ''); // Precargar mensaje de Copilot
      } else {
        setSuggestedReply('');
      }
    } catch (error) {
      console.error('Error al actualizar el modo Copilot:', error);
    }
  };

  const handleManualModeChange = async (event) => {
    const isManual = event.target.checked;
    setManualMode(isManual);

    if (isManual) {
      try {
        await pauseConversation(id, token); 
      } catch (error) {
        console.error('Error al pausar la conversación:', error);
      }
    } else {
      try {
        await resumeConversation(id, token); 
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

        setManualMessage('');
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
      logoSrc = WhatsAppLogo;
      canal = 'WhatsApp';
      break;
    case 1:
    case 6:
      logoSrc = InstagramLogo;
      canal = 'Instagram';
      break;
    default:
      logoSrc = WhatsAppLogo;
      canal = 'WhatsApp';
  }

  return (
    <div className={isMobile ? "ALL" : ""} style={{
      height: '100%', 
      display: 'flex', 
      flexDirection: isMobile ? 'column-reverse' : 'column',
      overflowX: 'auto',
      
    }}>
      <Navbar />
      <div style={{
        width: isMobile ? "100%" : "90%",
        marginLeft: isMobile ? "" : "5%",
        height: isMobile ? "750px" : "100%",
        zIndex: isMobile ? "2" : "",
        marginBottom: "-30px",
        overflow:"hidden"
      }}>
        <ConversationContainer canal={canal} style={{
          backgroundColor: "white", 
          height: isMobile ? "850px" : "100%", 
          borderRadius: isMobile ? "10px 10px 0px 0px" : "",
        }}>
          <ConversationsTop canal={canal} logoSrc={logoSrc} style={{ backgroundColor: "white" }} />
          <div style={{
            border: "0.3px solid #E1C9FF", 
            zIndex: "1111", 
            marginTop: "10px",
            marginBottom: isMobile ? "20px" : "0",
          }}></div>
          {
            !isMobile ? (
              <Box sx={{ marginTop: 2, display: 'flex', alignItems: 'center' }}>
                <Typography sx={{ marginRight: 2, marginLeft: 2 }}>Modo IA</Typography>
                <Switch checked={manualMode} onChange={handleManualModeChange} />
                <Typography sx={{ marginLeft: 2 }}>Modo Manual</Typography>
              </Box>
            ) :(
              <Box sx={{ marginTop: 2, display: 'flex', alignItems: 'center' }}>
                <Typography sx={{ marginRight: 2, marginLeft: 2 }}>Modo IA</Typography>
                <Switch checked={manualMode} onChange={handleManualModeChange} />
                <Typography sx={{ marginLeft: 2 }}>Modo Manual</Typography>
              </Box>
            ) 
          }
  <div
    style={{
      display: isMobile ? 'block' : 'flex',
      backgroundColor: 'white',
      flexDirection: isMobile ? 'column' : 'row',
      minHeight: isMobile ? '400px' : '100%',
      maxHeight: isMobile ? 'calc(100vh - 200px)' : '100%',  // Ajuste la altura de acuerdo a la pantalla
      overflowY: isMobile ? 'auto' : 'initial',
      position: 'relative',
      flexWrap: isMobile ? 'nowrap' : 'wrap',
    }}
  >
            <ConversationHeader conversation={conversation} id={id} isMobile={isMobile} />
           
            <MessageList conversation={conversation} isManual={manualMode}/>
          </div>
            
          {manualMode && (
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px',
              borderRadius: '10px',
              marginTop: 2,
              width: "100%",
              justifyContent: "flex-end",
            }} ref={textFieldRef}>
              <TextField
                fullWidth
                placeholder="Escribe un mensaje..."
                value={copilotMode ? suggestedReply : manualMessage}
                onChange={handleManualMessageChange}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSendManualMessage();
                  }
                }}
                variant="outlined"
                multiline
                style={{
                  width: "65%",
                  display: "flex",
                  justifyContent: "flex-end",
                }}
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
                  alignSelf: "center",
                  height: "40px",
                  width: "4%",
                  backgroundColor: '#25d366',
                  '&:hover': {
                    backgroundColor: '#22b358',
                  },
                }}
              >
                <SendIcon sx={{ color: 'white', width: "100%" }} />
              </IconButton>
            </Box>
          )}
        </ConversationContainer>
      </div>

      {isMobile && (
        <div style={{
          zIndex: "2", 
          margin: "auto", 
          display: "flex", 
          alignItems: "center", 
          marginTop: "4%", 
          gap: "20px", 
          marginBottom: "7%",
        }}>
          <img src={Logo} style={{ width: "20%", marginBottom:"10px" }} />
          <img src={SimpleAI} style={{ width: "80%" }} />
        </div>
      )}
    </div>
  
  );
};

export default ConversationDetails;
