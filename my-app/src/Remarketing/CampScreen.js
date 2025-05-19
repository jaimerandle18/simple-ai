import React, {useState} from 'react';
import { Box, Typography, useMediaQuery } from '@mui/material';
import Formulario from './FormRemark';
import Notificaciones from './Notification';
import Navbar from '../Home/Navbar';

const CampañaScreen = () => {
    const [openSnack, setOpenSnack] = useState(false);
    const isMobile = useMediaQuery('(max-width:600px)');

    const handleCampaignSaved = () => {
        setOpenSnack(true);
    };

    return (
        <>
            <Navbar />
            <div style={{ height: '100vh', padding: '2%', overflow: "auto" }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <h1 style={{ fontSize:isMobile?"25px":"25px", color: "purple", marginTop: "10px" }}>
                       Seguimiento
                    </h1>

                    <Formulario onCampaignSaved={handleCampaignSaved} />

                    <Notificaciones
                        open={openSnack}
                        onClose={() => setOpenSnack(false)}
                        message="¡Campaña programada con éxito!"
                    />
                </Box>
            </div>
        </>
    );
};

export default CampañaScreen;