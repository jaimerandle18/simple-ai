import React, { useState } from 'react';
import { Select, MenuItem, Button } from '@mui/material';
import Listado from "../assets/description.png";
import FileUpload from './fileUpload';

function Header({ assistants, selectedAssistant, onAssistantChange, isMobile, navigate, startNewConversation }) {
  const [selectedFile, setSelectedFile] = useState(null);

  // Función que se ejecuta cuando se selecciona un archivo
  const handleFileSelect = (file) => {
    setSelectedFile(file);  // Guardamos el archivo seleccionado en el estado
    console.log('Archivo seleccionado:', file);
  };

  
  return (
    <div className="header-container" style={{display:isMobile?'flex':'',flexDirection:isMobile?"column":"",marginBottom:isMobile?"20px":""}}>
      <h1 style={{ fontSize:isMobile?"25px":"25px", color: "purple", marginTop: "10px" }}>Configuración asistente</h1>
      <div style={{display:"flex",gap:isMobile?"10px":"20px",justifyContent:"space-between",width:isMobile?"100%":"70%",marginTop:isMobile?"20px":""}}>
        <Button 
          onClick={() => navigate("/home")}
          sx={{
            display: "flex",
            width: "35%",
            border: "1px solid grey",
            height: "50px",
            backgroundColor: "white",
            color: "grey",
            '&:hover': {
              backgroundColor: "rgb(67, 10, 98)", 
              color: "white",
            }
          }}
        >
          {isMobile && <img src={Listado} alt="" style={{ height: "20px" }} />}
          {!isMobile && <p style={{ marginTop: "20px", marginLeft: "5px", fontSize: "15px" }}>Volver al dashboard</p>}
        </Button>
        
        <Button 
          onClick={startNewConversation}
          sx={{
            display: "flex",
            width: isMobile?"50%":"35%",
            border: "1px solid grey",
            height: "50px",
            backgroundColor: "white",
           
            color: "grey",
            '&:hover': {
              backgroundColor: "rgb(67, 10, 98)",
              color: "white",
            }
          }}
        >
          Nueva Conversación
        </Button>

        <Select 
          value={selectedAssistant} 
          onChange={(e) => onAssistantChange(e.target.value)} 
          sx={{
            display: "flex",
            width: "35%",
            border: "1px solid grey",
            height: "50px",
            backgroundColor: "white",
            color: "grey",
            '&:hover': {
              backgroundColor: "rgb(67, 10, 98)",
              color: "white",
            }
          }}
        >
     {assistants.sort((a, b) => a.id - b.id).map((assistant) => (
  <MenuItem key={assistant.id} value={assistant}>
    {assistant.name}
  </MenuItem>
))}
        </Select>
          <FileUpload  isMobile={isMobile} />
      </div>
    </div>
  );
}

export default Header;
