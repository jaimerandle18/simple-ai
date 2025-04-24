import React from 'react';
import { Card, CardContent, Typography, Box, Avatar, Icon } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';

const InsurerCard = ({ insurer, onClick, width }) => {
  const hasCredentials = insurer?.userName;

  return (
    <Card
      sx={{
        width: width,
        cursor: 'pointer',
        transition: 'transform 0.3s ease, box-shadow 0.3s ease',
        '&:hover': {
          transform: 'translateY(-5px)',
          boxShadow: '0 8px 15px rgba(0, 0, 0, 0.2)',
        },
        position: 'relative', // Para posicionar el icono absolutamente
      }}
      onClick={() => onClick(insurer)}
    >
      <CardContent>
        <Typography variant="h6" style={{ display: 'flex', justifyContent: 'center' }}>
          {insurer.companyName}
        </Typography>
        {insurer.imageUrl && (
          <Box sx={{ display: 'flex', justifyContent: 'center', marginTop: '8px' }}>
            <Avatar src={insurer.imageUrl} alt={insurer.companyName} sx={{ width: 56, height: 56 }} />
          </Box>
        )}
        <Box
          sx={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            zIndex: 1, // Asegurar que el icono esté por encima de la tarjeta
          }}
        >
          {hasCredentials ? (
            <CheckCircleOutlineIcon color="success" />
          ) : (
            <WarningAmberOutlinedIcon color="warning" />
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default InsurerCard;