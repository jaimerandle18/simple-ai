import React, { useState, useEffect } from 'react';
import { Typography, Button, TextField, ListItem, ListItemIcon, ListItemText, Box, Select, MenuItem, FormControl, InputLabel, IconButton } from '@mui/material';
import InstagramIcon from '@mui/icons-material/Instagram';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'; // Flecha hacia abajo
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';

const InstagramHandler = ({ clientId, user }) => {
  const [qrUrl, setQrUrl] = useState(""); // Para almacenar la URL del QR
  const [isLoading, setIsLoading] = useState(false); // Para manejar el estado de carga
  const [showInput, setShowInput] = useState(false); // Para mostrar/ocultar el formulario de entrada
    
  const loginInsta = (event) => {
    console.log("insta");
    // Aquí abrimos la URL en una nueva ventana/pestaña, reemplazando {id_del_cliente} por el valor de clientId
    const authUrl = `https://zgo5ag3batxfe3pclxgsksdfly0jczub.lambda-url.us-east-1.on.aws/init-auth/2?clientId=${clientId}`;
    window.open(authUrl, '_blank');
  };
    
  return (
    <ListItem style={{ marginTop: '0px', display: 'inline-block', flexDirection: 'column', alignItems: 'flex-start', width:"80%"}}>
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
          <ListItemIcon style={{ marginTop: "-20px" }} onClick={() => setShowInput(!showInput)}>
            <InstagramIcon style={{color:"#8a3ab9"}} />
          <ListItemText primary="Instagram"  style={{marginLeft:"30px", color: "black"}}/>
          <IconButton onClick={() => setShowInput(!showInput)} style={{ marginLeft: 'auto' }}>
            {showInput ?<ArrowDropUpIcon style={{marginTop:"-3px"}}  />: <ArrowDropDownIcon style={{marginTop:"-3px"}} /> }
          </IconButton>
          </ListItemIcon>
        </div>
        
        {showInput && (
            <Button
                variant="contained"
                color="primary"
                onClick={loginInsta}
                style={{ width: '100%' }}
            >
                {'Conectar'}
            </Button>
        )}
      </div>
    </ListItem>
  );
};

export default InstagramHandler;