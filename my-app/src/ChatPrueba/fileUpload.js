import React, { useState, useEffect, useCallback } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Tooltip,
  Box,
  Paper,
  Divider,
} from '@mui/material';
import {
  uploadFile,
  getUserFiles,
  deleteFiles,
  getPresignedUrl,
  postFilesAlert,
} from '../services/bffService';
import {
  ContentCopy as ContentCopyIcon,
  Delete as DeleteIcon,
  CloudUpload as CloudUploadIcon,
  Description as DescriptionIcon,
} from '@mui/icons-material';
import FileUploadInfo from './infoGestor';

const FileUpload = ({ isMobile }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [selectedFileDetails, setSelectedFileDetails] = useState(null);
  const [openFileModal, setOpenFileModal] = useState(false);
  const [openDeleteModal, setOpenDeleteModal] = useState(false);
  const [fileToDelete, setFileToDelete] = useState(null);
  const [filesLoaded, setFilesLoaded] = useState(false);

  const cachedUserInfo = localStorage.getItem('userInfo');
  const clientId = cachedUserInfo ? JSON.parse(cachedUserInfo).client_id : null;
  const token = localStorage.getItem('authToken');
  const asistantId = JSON.parse(sessionStorage.getItem("asistentes"))
  console.log(asistantId, "asistantid")

  const loadUploadedFiles = async () => {
    try {
      const files = await getUserFiles(clientId, token);
      setUploadedFiles(files.list);
    } catch (error) {
      console.error('Error al cargar archivos:', error);
    }
  };

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files[0];
    console.log(file, "file")
    if (file && clientId) {
        setSelectedFile(file);
        setLoading(true);
        const getFileExtension = (fileType) => {
            if (!fileType) {
                return ''; // O maneja el caso donde fileType es null/undefined como prefieras
            }
            const index = fileType.indexOf('/');
            if (index !== -1) {
                return fileType.substring(index + 1);
            }
            return ''; // O maneja el caso donde el formato no es el esperado
        };
        try {
            // Obtener la URL pre-firmada desde el backend
            const presignedUrlResponse = await getPresignedUrl(file.name, getFileExtension(file.type), token, file.size, clientId);

            const presignedUrl = presignedUrlResponse.url;

            // Subir el archivo usando la URL pre-firmada
            await uploadFile(file.name, getFileExtension(file.type), presignedUrl, token);
            await postFilesAlert( asistantId[0].id ,token);

            setLoading(false);
            loadUploadedFiles();
        } catch (error) {
            console.error('Error al subir el archivo:', error);
            setLoading(false);
        }
    } else {
        console.error('No se pudo obtener el clientId o no se seleccionó un archivo');
    }
}, [clientId, token, loadUploadedFiles]);

  const handleDeleteFile = useCallback(async () => {
    try {
      if (fileToDelete) {
        await deleteFiles(clientId, token, fileToDelete);
        loadUploadedFiles();
        setOpenDeleteModal(false);
      }
    } catch (error) {
      console.error('Error al eliminar archivo:', error);
    }
  }, [clientId, token, fileToDelete, loadUploadedFiles]);

  const handleFileClick = useCallback((file) => {
    const fileUrl = `https://simple-ai-client-data.s3.amazonaws.com/${clientId}/public/${file}`;

    // Extraer el nombre del archivo sin la extensión
    const fileNameWithoutExtension = file;
    setSelectedFileDetails({ name: fileNameWithoutExtension, url: fileUrl});
    setOpenFileModal(true);
  }, [clientId]);

  const handleCloseFileModal = useCallback(() => {
    setOpenFileModal(false);
    setSelectedFileDetails(null);
  }, []);

  const copyToClipboard = useCallback(() => {
    if (selectedFileDetails && selectedFileDetails.url) {
      navigator.clipboard.writeText(selectedFileDetails.url);
      alert('URL copiada al portapapeles');
    }
  }, [selectedFileDetails]);

  const openDeleteConfirmationModal = useCallback((file) => {
    setFileToDelete(file);
    setOpenDeleteModal(true);
  }, []);

  const closeDeleteConfirmationModal = useCallback(() => {
    setOpenDeleteModal(false);
    setFileToDelete(null);
  }, []);

  useEffect(() => {
    if (clientId && !filesLoaded) {
      loadUploadedFiles();
      setFilesLoaded(true); // Marcar como cargado
    }
  }, [clientId, filesLoaded, loadUploadedFiles]);

  return (
    <div>
      <Button
        variant="outlined"
        startIcon={<CloudUploadIcon />}
        onClick={() => setIsModalOpen(true)}
        sx={{ width: isMobile ? '100%' : 'auto', mb: 2 , height:"50px" }}
      >
        Cargar archivos
      </Button>

      <Dialog open={isModalOpen} onClose={() => setIsModalOpen(false)} fullWidth maxWidth="md" style={{marginTop:"50px"}}>
        <DialogContent sx={{ maxHeight: '600px', overflowY: 'auto' }}> {/* Altura máxima y scroll */}
          <FileUploadInfo />
          <Divider sx={{ my: 2 }} />
          <Typography variant="h6" gutterBottom>Archivos cargados:</Typography>
          <Paper elevation={3} sx={{ p: 2, maxHeight: '300px', overflowY: 'auto' }}> {/* Altura máxima y scroll */}
            <List>
              {uploadedFiles.map((file, index) => (
                <ListItem key={index} secondaryAction={
                  <Tooltip title="Eliminar">
                    <IconButton edge="end" aria-label="delete" onClick={() => openDeleteConfirmationModal(file)}>
                      <DeleteIcon color="error" />
                    </IconButton>
                  </Tooltip>
                }>
                  <ListItemIcon>
                    <DescriptionIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={isMobile
                      ? file.length > 30
                        ? file?.substring(0, 30) + '...'
                        : file
                      : file.length > 70
                        ? file?.substring(0, 69) + '...'
                        : file}
                    onClick={() => handleFileClick(file)}
                    sx={{ cursor: 'pointer' }}
                  />
                </ListItem>
              ))}
            </List>
          </Paper>
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <input
              type="file"
              id="file-input"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <Button
              variant="contained"
              component="label"
              htmlFor="file-input"
              startIcon={<CloudUploadIcon />}
              disabled={loading}
            >
              {loading ? <CircularProgress size={24} sx={{ color: 'white' }} /> : 'Subir nuevo archivo'}
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsModalOpen(false)} color="primary">Cerrar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={openFileModal} onClose={handleCloseFileModal} fullWidth maxWidth="sm">
        <DialogTitle> <h4 style={{color: 'purple'}}>Detalles del Archivo</h4></DialogTitle>
        <DialogContent>
          <Typography variant="h6">Nombre:</Typography>
          <Typography variant="body1">{selectedFileDetails?.name}</Typography>
          <Typography variant="h6" sx={{ mt: 2 }}>URL:</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="body2" sx={{ flexGrow: 1, overflowWrap: 'break-word' }}>
              {selectedFileDetails?.url}
            </Typography>
            <Tooltip title="Copiar URL">
              <IconButton onClick={copyToClipboard}>
                <ContentCopyIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseFileModal} color="primary">Cerrar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={openDeleteModal} onClose={closeDeleteConfirmationModal}>
        <DialogTitle>Confirmación de eliminación</DialogTitle>
        <DialogContent>
          <Typography variant="h6">
            ¿Estás seguro de que quieres eliminar el archivo: <strong>{fileToDelete?.substring(0, fileToDelete.lastIndexOf('.'))}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteConfirmationModal} color="primary">No</Button>
          <Button onClick={handleDeleteFile} color="error">Sí</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default FileUpload;