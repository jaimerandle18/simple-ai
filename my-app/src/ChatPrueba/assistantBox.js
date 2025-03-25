import React, { useState, useEffect } from 'react';
import Loading from '../components/Loading';
import Spinner from 'react-bootstrap/esm/Spinner';

function AssistantBox({ assistantInput, onPromptChange, onSend, loading }) {
  const [displayInput, setDisplayInput] = useState(assistantInput);
  const [originalInput, setOriginalInput] = useState(assistantInput); // Variable para el valor original

  useEffect(() => {
    const documentRegex = /##DOCUMENTOS##([\s\S]*?)##DOCUMENTOS_FIN##/;
    const match = originalInput.match(documentRegex);

    if (match && match[1]) {
      // Elimina el bloque ##DOCUMENT##...##DOCUMENT## para la visualización
      setDisplayInput(originalInput.replace(documentRegex, ''));
    } else {
      setDisplayInput(originalInput);
    }
    
  }, [originalInput]);

  const handleInputChange = (event) => {
    // Actualiza el valor original y la visualización
    setOriginalInput(event.target.value);
    setDisplayInput(event.target.value);
    onPromptChange(event);
  };

  const handleSend = () => {
    // Envía el valor original al backend
    onSend(originalInput);
  };

  return (
    <div className="assistant-box">
      <textarea
        value={displayInput}
        onChange={handleInputChange}
        placeholder="Agrega instrucciones adicionales para el asistente"
      />
      <button onClick={handleSend} style={{ fontWeight: 'bold', marginTop: '5px', backgroundColor: "rgb(67, 10, 98)" }}>
        {loading ? <Spinner style={{ height: "20px", width: "20px" }} /> : "ENVIAR A ASISTENTE"}
      </button>
    </div>
  );
}

export default AssistantBox;