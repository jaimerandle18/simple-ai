import React, { useState, useEffect } from 'react';
import { Typography, Button, TextField, ListItem, ListItemIcon, ListItemText, Box, Select, MenuItem, FormControl, InputLabel, IconButton } from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import apiClient from '../services/apiClient';
import { QRCode, QRCodeSVG } from 'qrcode.react'; // Importa la librería QRCode
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'; // Flecha hacia abajo
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';

const WhatsAppQrHandler = ({ clientId, user }) => {
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [qrUrl, setQrUrl] = useState(""); // Para almacenar la URL del QR
  const [phone, setPhone] = useState([]); // Numero de telefono logeado
  const [qrStatus, setQrStatus] = useState(null); // Para almacenar el estado del QR
  const [isLoading, setIsLoading] = useState(false); // Para manejar el estado de carga
  const [isCheckingQr, setIsCheckingQr] = useState(false); // Para manejar el estado de verificación del QR
  const [showInput, setShowInput] = useState(false); // Para mostrar/ocultar el formulario de entrada
  const [selectedAssistant, setSelectedAssistant] = useState(''); // Para almacenar el asistente seleccionado

  // Obtener los asistentes desde sessionStorage
  const assistantsData = JSON.parse(sessionStorage.getItem('asistentes')) || [];
  const Token = localStorage.getItem("authToken")
  console.log(selectedAssistant, "asistente seleccionado")

  const handleInputChange = (event) => {
    const value = event.target.value.replace(/\D/g, ''); 
    setWhatsappNumber(value);
  };

  const handleGenerateQr = async () => {
    if (!selectedAssistant) {
      alert('Por favor selecciona un asistente');
      return;
    }

    setIsLoading(true);
    setQrUrl(null); // Limpiar cualquier QR previo
    setQrStatus(null); // Limpiar el estado del QR

    try {
        const response = await apiClient.post('/userQr', 
          { 
            clientId, 
            assistId: selectedAssistant, 
            phone: "549" + whatsappNumber 
          }, 
          {
            headers: {
              'Authorization': `Bearer ${Token}`
            }
          }
        );
      
      // Guardamos la URL del QR que se nos devuelve
      setQrUrl(response.data.qr);
    } catch (error) {
      console.error('Error generando el QR:', error);
      alert('Hubo un error generando el QR.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckQrStatus = async () => {
    setIsCheckingQr(true);

    try {
      const response = await apiClient.get(`/qr/${"549" + whatsappNumber}`,{
      headers: {
          'Authorization': `Bearer ${Token}`,
      }
  }); 
      
      console.log(response.data)
      if (response.status === 200) {
        setQrUrl(response.data.qr)
        console.log(qrUrl)
        setQrStatus('QR escaneado y activo');
      }
    } catch (error) {
      if (error.response && error.response.status === 400) {
        setQrStatus('Ya logueado (QR escaneado)');
      } else {
        console.error('Error verificando el QR:', error);
        setQrStatus('Hubo un error al verificar el estado del QR.');
      }
    } finally {
      setIsCheckingQr(false);
    }
  };

  // const phonesStatus = async () => {
  //   try{
  //     const response = await  apiClient.get('/isActivatePhone',{
  //       headers: {
  //         'Authorization':`Bearer ${Token}`
  //       }
  //     })
  //     if(response.status === 200){
  //       console.log(response.data.phones)
  //       setPhone(response.data.phones)
        
  //     }
  //   }catch(error){

  //   }
  // }

  // useEffect(() => {
  //   console.log("Estado de phone actualizado:", phone);
  // }, [phone]);


  useEffect(() => {
    // Solo verificar el estado del QR si el número de teléfono está disponible y el QR ha sido generado
    if (qrUrl) {
      const interval = setInterval(() => {
        handleCheckQrStatus();
      }, 20000); // Verificar cada 20 segundos

      return () => {clearInterval(interval)}; // Limpiar el intervalo cuando el componente se desmonte
    }
  }, [handleGenerateQr]);



  // useEffect(() => {
  //   phonesStatus();
  //   const interval = setInterval(() => {
  //     phonesStatus();
  //     console.log('Verificando estado de teléfonos...');
  //   }, 20000);
    
  //   return () => {clearInterval(interval);}
  // }, []); 



  return (
    <ListItem style={{ marginTop: '0px', display: 'inline-block', flexDirection: 'column', alignItems: 'flex-start', width:"80%"}}>
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "5px" }}>
          <ListItemIcon style={{ marginTop: "-20px" }} onClick={() => setShowInput(!showInput)}>
            <WhatsAppIcon  style={{color:"green", marginTop:"2px"}}/>
          <ListItemText primary="WhatsApp"  style={{marginLeft:"30px", color: "black"}}/>
          <IconButton onClick={() => setShowInput(!showInput)} style={{ marginLeft: 'auto' }}>
            {showInput ?<ArrowDropUpIcon style={{marginTop:"-3px"}}  />: <ArrowDropDownIcon style={{marginTop:"-3px"}} /> }
          </IconButton>
          </ListItemIcon>
        </div>
    
        {showInput && (
          <Box>
            
            {/* {phone && phone.length > 0 ? (
              <div>
                {phone.map((item, index) => (
                  <Typography 
                    key={index} 
                    color={item.enabled ?(item.isLogin ? 'green' : 'red'):'gray'}
                  >
                    {item.phone} 
                  </Typography>
                ))}
              </div>
            ) : (
              <Typography>No hay teléfonos registrados</Typography>
            )}
          */}

            <TextField
              helperText="Ingresar el numero sin +954"
              FormHelperTextProps={{style: {color: "grey"}}}
              value={whatsappNumber}
              type='tel'
              onChange={handleInputChange}
              inputProps={{
                maxLength: 11,
                inputMode: 'numeric'
              }}
              fullWidth
              style={{ marginBottom: '10px' }}
              InputLabelProps={{
                style: { color: 'grey' }
              }}
            />
            
            {/* Mostrar el Select con los asistentes */}
            <FormControl fullWidth style={{ marginBottom: '10px' }}>
              <Select
                value={selectedAssistant}
                onChange={(e) => setSelectedAssistant(e.target.value)}
                helperText="Selecciona un asistente"
                FormHelperTextProps={{style: {color : "grey"}}}
              >
                {assistantsData.map((assistant) => (
                  <MenuItem key={assistant.id} value={assistant.oai_assistant_id}>
                    {assistant.name}
                  </MenuItem>
                ))}
              </Select>
              <p style={{color:'grey', fontSize:"12px", marginLeft:"20px", fontWeight:"bold"}}>Selecciona un asistente</p>
            </FormControl>
            
            <Button
              variant="contained"
              color="primary"
              onClick={handleGenerateQr}
              style={{ width: '100%' }}
              disabled={isLoading || qrUrl}
            >
              {isLoading ? 'Generando...' : 'Generar QR'}
            </Button>

            {/* Si qrUrl existe, genera y muestra el código QR usando qrcode.react */}
            {qrUrl && (
              <div style={{ marginTop: '20px' }}>
                <QRCodeSVG value={qrUrl} size={256} style={{ maxWidth: '100%' }} />
              </div>
            )}

            {qrStatus && (
              <Typography variant="body1" style={{ marginTop: '10px' }}>
                {qrStatus}
                {phone}
              </Typography>
            )}
          </Box>
        )}
      </div>
    </ListItem>
  );
};

export default WhatsAppQrHandler;
