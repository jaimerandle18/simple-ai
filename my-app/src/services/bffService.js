
import apiClient from './apiClient';

export const loginAuth = async (email, password) => {
    try {
        const response = await apiClient.post('/login', {
            email,
            pass: password,
        });

        return response.data.token;  // Devuelve el token si la solicitud fue exitosa
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error during login');
    }
};

export const getUserInfo = async (token) => {
    try {
        const response = await apiClient.get('/me', {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });

        return response.data;  // Devuelve la información del usuario
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error fetching user info');
    }
};

export const getConversations = async (token) => {
    try {
        const response = await apiClient.get('/conversations', {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });

        return response.data;  // Devuelve el array de conversaciones
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error fetching conversations');
    }
};

export const getConversationDetails = async (id, token) => {
    try {
        const response = await apiClient.get(`/conversations/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });

        return response.data;  // Devuelve los detalles de la conversación
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error fetching conversation details');
    }
};

export const updateConversationMetadata = async (id, metadata, token) => {
    try {
        const response = await apiClient.post(`/conversations/${id}/metadata`, metadata, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });

        return response.data;  // Devuelve la respuesta de la actualización
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to update conversation metadata');
    }
};

export const deleteConversation = async (id, token) => {
    try {
        const response = await apiClient.delete(`/conversations/${id}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });

        return response.data;  // Devuelve la respuesta de la eliminación
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to delete conversation');
    }
};

export const getAssistants = async (token) => {
    try {
        const response = await apiClient.get('/assistants', {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
        return response.data;  // Devuelve la lista de asistentes
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error fetching assistants');
    }
};

// Actualizar el asistente
export const updateAssistant = async (id, updatedAssistant, token) => {
    try {
        const response = await apiClient.put(`/assistants/${id}`, updatedAssistant, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
        return response.data;  // Devuelve la respuesta de la actualización
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Failed to update assistant');
    }
};

export const pauseConversation = async (id, token) => {
    try {
        const response = await apiClient.post(`/conversations/${id}/pause`, {}, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
        return response.data;  // Devuelve la respuesta de la conversación pausada
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error pausing the conversation');
    }
};

export const resumeConversation = async (id, token) => {
    try {
        const response = await apiClient.post(`/conversations/${id}/resume`, {}, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
        return response.data;  // Devuelve la respuesta de la conversación reanudada
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error resuming the conversation');
    }
};


export const sendManualMessage = async (conversationId, message) => {
    try {
      await fetch(`/conversations/${conversationId}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: message }),
      });
      console.log('Mensaje manual enviado');
    } catch (error) {
      console.error('Error al enviar mensaje manual:', error);
    }
  };

  export const replyToConversation = async (id, message, token) => {
    try {
        const response = await apiClient.post(`/conversations/${id}/reply`, message, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            }
        });
        return response.data;  // Devuelve la respuesta de enviar el mensaje
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error sending manual message');
    }
};

export const getChannels = async (token) => {
    try {
        const response = await apiClient.get('/channels', {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
        return response.data;  // Devuelve la lista de canales
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error fetching channels');
    }
};

// Subir un archivo
export const getPresignedUrl = async (fileName, type, token, size, clientId) => {
    try {
        const response = await apiClient.post(`/files`, {
            name: fileName,
            type: type,
            sizeFile: size,
            clientId: clientId
        }, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error fetching presigned url');
    }
};

// Subir un archivo usando una URL pre-firmada
export const uploadFile = async (fileName, fileType, presignedUrl, file) => {
    try {
        const response = await fetch(presignedUrl, {
            method: 'PUT',
            body: file,
            headers: {
                'Content-Type': fileType,
            },
        });

        if (!response.ok) {
            throw new Error(`Error al subir el archivo: ${response.statusText}`);
        }

        return response;
    } catch (error) {
        throw new Error('Error al subir el archivo a S3');
    }
};

export const getUserFiles = async (userId, token) => {
    try {
        const response = await apiClient.get(`/listFilesUser/${userId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error fetching user files');
    }
};

export const deleteFiles = async (userId, token, file) => {
    try {
      const response = await apiClient.delete(`/filesUser/${userId}`, {
          headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',  // Especificamos que el cuerpo es JSON
          },
          data: { filename: file },  // Utilizamos `data` en lugar de `body` para algunas bibliotecas HTTP (como Axios)
      });

      return response.data;  // Devuelve los archivos del usuario
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Error al eliminar el archivo');
    }
};

export const createPeriodicJob = async (clientId, name, params, token, schedule) => {
    try {
        const response = await fetch('https://uzsdo6wiqd67bpntxajmtpczia0sanpr.lambda-url.us-east-1.on.aws/periodicjobs', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json', // Agrega el header Content-Type
            },
            body: JSON.stringify({ // Serializa el cuerpo como JSON
                client_id: clientId,
                name: name,
                config: params, // No necesitas serializar params aquí, ya que JSON.stringify lo hace
                schedule: schedule,
            }),
        });

        if (!response.ok) {
            // Maneja el error si la respuesta no es exitosa
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error creating periodic job');
        }

        return await response.json(); // Parsea la respuesta JSON
    } catch (error) {
        throw new Error(error.message || 'Error creating periodic job');
    }
};

export const getPeriodicJobs = async (clientId, token) => {
    try {
        const response = await fetch(`https://uzsdo6wiqd67bpntxajmtpczia0sanpr.lambda-url.us-east-1.on.aws/periodicjobs?client_id=${clientId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Error fetching periodic jobs');
        }

        return await response.json();
    } catch (error) {
        throw new Error(error.message || 'Error fetching periodic jobs');
    }
};

export const updatePeriodicJob = async (id, campaignData, token) => {
    try {
        const response = await fetch(`https://uzsdo6wiqd67bpntxajmtpczia0sanpr.lambda-url.us-east-1.on.aws/periodicjobs/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ // Construye un objeto con los datos
                name: campaignData.name,
                config: campaignData.config,
                schedule: campaignData.schedule,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Error al actualizar la campaña: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(error.message || `Error al actualizar la campaña`);
    }
};

export const deletePeriodicJob = async (id, token) => {
    try {
        const response = await fetch(`https://uzsdo6wiqd67bpntxajmtpczia0sanpr.lambda-url.us-east-1.on.aws/periodicjobs/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Error al eliminar la campaña: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(error.message || `Error al eliminar la campaña`);
    }
};

export const postFilesAlert = async (assistantId, token) => {
    try {
        const response = await apiClient.post(`/assistants/${assistantId}/upload-files`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || 'Error fetching presigned url');
    }
};
  
  

