import React, { useEffect, useState } from 'react';
import { Box, Button, Modal, TextField, Typography, IconButton, FormControl, InputLabel, Select, MenuItem, Grid } from '@mui/material';
import { getPeriodicJobs, updatePeriodicJob, deletePeriodicJob } from '../services/bffService';
import Delete from '@mui/icons-material/Delete';
import { Edit } from '@mui/icons-material';

const CampañasListadas = ({ campaign, campaignAdded }) => {
    const [campaigns, setCampaigns] = useState([]);
    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editedCampaign, setEditedCampaign] = useState(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [campaignToDelete, setCampaignToDelete] = useState(null);
    const [editedFrequency, setEditedFrequency] = useState('');
    const [localCampaignAdded, setLocalCampaignAdded] = useState(false);
    const [editedStartDateDaysAgo, setEditedStartDateDaysAgo] = useState('');
    const [editedEndDateDaysAgo, setEditedEndDateDaysAgo] = useState('');

    useEffect(() => {
        const fetchCampaigns = async () => {
            try {
                const token = localStorage.getItem('authToken');
                const userInfo = JSON.parse(localStorage.getItem("userInfo"));
                const clientId = userInfo.client_id;
                const fetchedCampaigns = await getPeriodicJobs(clientId, token);
                setCampaigns(fetchedCampaigns);
                setLocalCampaignAdded(true);
            } catch (error) {
                console.error('Error al obtener las campañas:', error);
            }
        };

        fetchCampaigns();
    }, [campaign, campaignAdded]);


    useEffect(() => {
        setLocalCampaignAdded(false);
    }, [localCampaignAdded]);

    const handleCampaignClick = (campaign) => {
        console.log('Campaña seleccionada:', campaign);
        setSelectedCampaign(campaign);
        // Aseguramos una copia profunda del objeto campaign
        setEditedCampaign(JSON.parse(JSON.stringify(campaign)));
        console.log('Estado editedCampaign inicial:', JSON.parse(JSON.stringify(campaign)));
        const frequency = scheduleToFrequency(campaign.schedule);
        console.log('Schedule de la campaña:', campaign.schedule);
        console.log('Frecuencia convertida:', frequency);
        setEditedFrequency(frequency);
        const startDate = campaign.config?.params?.minAgeHoursStart / 24;
        const endDate = campaign.config?.params?.minAgeHoursEnd / 24;
        console.log('Días atrás (Inicio):', startDate);
        console.log('Días atrás (Fin):', endDate);
        setEditedStartDateDaysAgo(startDate);
        setEditedEndDateDaysAgo(endDate);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditedCampaign(null); // Reseteamos el estado al cerrar el modal
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (name === 'message') {
            setEditedCampaign(prev => ({
                ...prev,
                config: {
                    ...prev.config,
                    params: {
                        ...prev.config.params,
                        prompt: value,
                    },
                },
            }));
        } else {
            setEditedCampaign(prev => ({
                ...prev,
                [name]: value,
            }));
        }
        // console.log(editedCampaign); // Para verificar la actualización del estado
    };

    const frequencyToHours = (freq) => {
        switch (freq) {
            case '5 horas':
                return 5;
            case '2 días':
                return 48;
            case '4 días':
                return 96;
            case '6 días':
                return 144;
            case '10 días':
                return 240;
            default:
                return 0;
        }
    };

    const scheduleToFrequency = (schedule) => {
        const parts = schedule.split(' ');
        if (parts.length === 6 && parts[1].startsWith('*/')) {
            const hours = parseInt(parts[1].substring(2), 10);
            if (hours === 5) return '5 horas';
            if (hours === 48) return '2 días';
            if (hours === 96) return '4 días';
            if (hours === 144) return '6 días';
            if (hours === 240) return '10 días';
        } else if (parts.length === 5 && parts[1].startsWith('*/')) {
            const hours = parseInt(parts[1].substring(2), 10);
            if (hours === 5) return '5 horas';
            if (hours === 48) return '2 días';
            if (hours === 96) return '4 días';
            if (hours === 144) return '6 días';
            if (hours === 240) return '10 días';
        }
        return 'Personalizado';
    };

    const handleFrequencyChange = (e) => {
        setEditedFrequency(e.target.value);
    };

    const handleUpdateCampaign = async () => {
        try {
            const token = localStorage.getItem('authToken');
            const hours = frequencyToHours(editedFrequency);
            const newSchedule = `* */${hours} * * *`;
            const updatedCampaign = {
                ...editedCampaign,
                schedule: newSchedule,
                config: {
                    params: {
                        ...editedCampaign.config.params,
                        minAgeHoursStart: Number(editedStartDateDaysAgo) * 24,
                        minAgeHoursEnd: Number(editedEndDateDaysAgo) * 24,
                    },
                },
            };
            await updatePeriodicJob(editedCampaign.id, updatedCampaign, token);
            const updatedCampaigns = campaigns.map(campaign => campaign.id === editedCampaign.id ? updatedCampaign : campaign);
            setCampaigns(updatedCampaigns);
            setIsModalOpen(false);
            setEditedCampaign(null); // Reseteamos el estado después de guardar
        } catch (error) {
            console.error('Error al actualizar la campaña:', error);
        }
    };

    const handleOpenDeleteModal = (campaign) => {
        setCampaignToDelete(campaign);
        setIsDeleteModalOpen(true);
    };

    const handleCloseDeleteModal = () => {
        setIsDeleteModalOpen(false);
        setCampaignToDelete(null);
    };

    const handleDeleteCampaign = async () => {
        try {
            const token = localStorage.getItem('authToken');
            await deletePeriodicJob(campaignToDelete.id, token);
            const updatedCampaigns = campaigns.filter(campaign => campaign.id !== campaignToDelete.id);
            setCampaigns(updatedCampaigns);
            setIsDeleteModalOpen(false);
        } catch (error) {
            console.error('Error al eliminar la campaña:', error);
        }
    };

    return (
        <>
            <Typography variant="h6" gutterBottom>
                Campañas Programadas:
            </Typography>
            <Box sx={{
                width: '100%',
                marginTop: '24px',
                minHeight: '20vh',
                maxHeight: '70vh',
                overflow: 'auto',
                paddingBottom: '56px',
            }}>
                {campaigns?.length > 0 ? (
                    campaigns.map((campaign) => (   
                        <Box
                            key={campaign.id}
                            sx={{
                                marginBottom: '8px',
                                padding: '8px',
                                border: '1px solid #ccc',
                                borderRadius: '8px',
                                backgroundColor: '#f9f9f9',
                                cursor: 'pointer',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}
                        >
                            <Typography variant="body1">
                                <strong>Titulo:</strong> {campaign.name}
                            </Typography>
                            <Box>
                                <IconButton onClick={() => handleCampaignClick(campaign)}>
                                    <Edit style={{ color: "purple" }} />
                                </IconButton>
                                <IconButton onClick={() => handleOpenDeleteModal(campaign)}>
                                    <Delete style={{ color: "red" }} />
                                </IconButton>
                            </Box>
                        </Box>
                    ))
                ) : (
                    <Typography variant="body2" color="gray">
                        No hay campañas programadas.
                    </Typography>
                )}
            </Box>

            <Modal open={isDeleteModalOpen} onClose={handleCloseDeleteModal}>
                <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 400, bgcolor: 'background.paper', boxShadow: 24, p: 4 }}>
                    <Typography variant="h6" gutterBottom>
                        ¿Estás seguro que deseas eliminar la campaña "{campaignToDelete?.name}"?
                    </Typography>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                        <Button onClick={handleCloseDeleteModal} sx={{ mr: 1 }}>Cancelar</Button>
                        <Button variant="contained" color="error" onClick={handleDeleteCampaign}>Eliminar</Button>
                    </Box>
                </Box>
            </Modal>

            <Modal open={isModalOpen} onClose={handleCloseModal}>
                <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 400, bgcolor: 'background.paper', boxShadow: 24, p: 4 }}>
                    <Typography variant="h6" gutterBottom>
                        Editar Campaña
                    </Typography>
                    <TextField
                        sx={{
                            '& .MuiInputLabel-root': { color: 'black' },
                            '& .MuiInputBase-root': { color: 'black' },
                        }}
                        label="Titulo"
                        name="name"
                        value={editedCampaign?.name || ''}
                        onChange={handleInputChange}
                        fullWidth
                        margin="normal"
                    />

                    <TextField
                        sx={{
                            '& .MuiInputLabel-root': { color: 'black' },
                            '& .MuiInputBase-root': { color: 'black' },
                        }}
                        label="prompt"
                        name="message"
                        value={editedCampaign?.config?.params?.prompt || ''}
                        onChange={handleInputChange}
                        fullWidth
                        margin="normal"
                        multiline
                        rows={4}
                    />

                    <FormControl fullWidth sx={{ marginBottom: "16px", '& .MuiInputLabel-root': { color: 'black' }, '& .MuiInputBase-root': { color: 'black' } }}>
                        <InputLabel id="frequency-label">Frecuencia</InputLabel>
                        <Select
                            labelId="frequency-label"
                            id="frequency-select"
                            value={editedFrequency}
                            label="Frecuencia"
                            onChange={handleFrequencyChange}
                        >
                            <MenuItem value="5 horas">5 horas</MenuItem>
                            <MenuItem value="2 días">2 días</MenuItem>
                            <MenuItem value="4 días">4 días</MenuItem>
                            <MenuItem value="6 días">6 días</MenuItem>
                            <MenuItem value="10 días">10 días</MenuItem>
                        </Select>
                    </FormControl>

                    <Grid container spacing={2} sx={{ marginBottom: '16px' }}>
                                <Grid item xs={6}>
                                    <TextField
                                        label="Días atrás (Inicio)"
                                        type="number"
                                        value={editedStartDateDaysAgo}
                                        onChange={(e) => setEditedStartDateDaysAgo(e.target.value)}
                                        variant="outlined"
                                        fullWidth
                                        size="small"
                                        sx={{
                                            '& .MuiInputLabel-root': { color: 'black' },
                                            '& .MuiInputBase-root': { color: 'black' },
                                        }}
                                    />
                                </Grid>
                        <Grid item xs={6}>
                            <TextField
                                label="Días atrás (Fin)"
                                type="number"
                                value={editedEndDateDaysAgo}
                                onChange={(e) => setEditedEndDateDaysAgo(e.target.value)}
                                variant="outlined"
                                fullWidth
                                size="small"
                                sx={{
                                    '& .MuiInputLabel-root': { color: 'black' },
                                    '& .MuiInputBase-root': { color: 'black' },
                                }}
                            />
                        </Grid>
                    </Grid>

                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                        <Button onClick={handleCloseModal} sx={{ mr: 1 }}>Cancelar</Button>
                        <Button variant="contained" color="primary" onClick={handleUpdateCampaign}>Guardar</Button>
                    </Box>
                </Box>
            </Modal>
        </>
    );
};

export default CampañasListadas;