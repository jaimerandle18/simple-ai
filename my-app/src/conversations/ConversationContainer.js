// src/components/ConversationContainer.js

import { useMediaQuery } from '@mui/material';
import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';

const ConversationContainer = styled(Box)(({ theme, canal }) => ({
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: canal === 'WhatsApp' ? 'black' : canal === 'Instagram' ? 'linear-gradient(to right, #833ab4, #fd1d1d, #fcb045)' : '#ffe600',
  padding: theme.spacing(2),
  height: '100%',
  marginTop: "-20px",
  overflow: useMediaQuery('(max-width:750px)') ? 'hidden' : "", // Añadido para evitar scroll en el contenedor principal
}));

export default ConversationContainer;
