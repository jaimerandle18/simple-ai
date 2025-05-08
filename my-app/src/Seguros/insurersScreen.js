import React, { useState, useEffect } from 'react';
import { Box, Typography, useMediaQuery, TextField } from '@mui/material';
import InsurerCard from './insurersCards';
import InsurerFormModal from './insurersFormModal';
import Navbar from '../Home/Navbar';
import { createInsurer, updateInsurer, deleteInsurer, getInsurers } from "../services/bffService";
import { ToastContainer, toast } from 'react-toastify';
import SimpleAI from '../assets/SimpleWhiteAI.png';
import Logo from '../assets/simpleLogo.webp';
import { useNavigate } from 'react-router-dom';
import { MobileHeader } from '../components/mobileHeader';

const defaultInsurersData = [
  { id: 1, companyName: 'Galicia', imageUrl: "https://segurocelular.com.ar/wp-content/uploads/2021/10/Galicia-logo-seguro-celu.png" },
  { id: 2, companyName: 'Rus', imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR5pOfAbSEl4EomHNPaOIyD9uZgslvWd9VPVA&s" },
  { id: 3, companyName: 'Swiss Medical', imageUrl: "https://www.swissmedical.com.ar/subsitio/swissmedicalseguros/assets/img/smg_seguros.svg" },
  { id: 4, companyName: 'Meridional', imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSMKPnO1qZ4ozDTBa9G-BKnCKbHkNWlB9KwhA&s" },
  { id: 6, companyName: 'Mercantil Andina', imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSxlBdNTYX7-jookaFL8yPCA-yQKMHV2zJz6g&s" },
  { id: 7, companyName: 'San Cristobal', imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSVjjvXJPN1ESPcivM8JDOHbKAU3PIoJiX44w&s" },
  { id: 8, companyName: 'Atm', imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTUxRjwE9b0K-gxJ0VCZfzlOwmcoNwZpfMP9w&s" },
  { id: 9, companyName: 'Federacion Patronal', imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRqSslIhUCDvLeXMZMTIvssBaqTH7zd6PUIZw&s" },
  { id: 10, companyName: 'Integrity', imageUrl: "https://media.licdn.com/dms/image/v2/C4E0BAQFgI5ayrJnWqQ/company-logo_200_200/company-logo_200_200/0/1630606984145/integrity_seguros_logo?e=2147483647&v=beta&t=n-vANhsa5Vh-uxv4gS3BxHWkybTKzVqoqHXeRJB2g3s" },
];

const InsurersScreen = () => {
  const isMobile = useMediaQuery('(max-width:600px)');
  const [allInsurers, setAllInsurers] = useState(defaultInsurersData);
  const [filteredInsurers, setFilteredInsurers] = useState(defaultInsurersData);
  const [selectedInsurer, setSelectedInsurer] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [searchText, setSearchText] = useState('');
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    userName: '',
    password: '',
    confirmPassword: '',
    companyName: '',
  });
  const token = localStorage.getItem('authToken');

  useEffect(() => {
    const fetchInsurers = async () => {
      if (token) {
        try {
          const data = await getInsurers(token);
          const mergedInsurers = defaultInsurersData.map(defaultInsurer => {
            const match = data.find(fetched => fetched.companyName === defaultInsurer.companyName);
            return match ? { ...defaultInsurer, userName: match.userName } : defaultInsurer;
          });
          setAllInsurers(mergedInsurers);
          setFilteredInsurers(mergedInsurers);
        } catch (error) {
          console.error('Error fetching insurers:', error);
          toast.error('No se pudieron cargar las aseguradoras.');
          setAllInsurers(defaultInsurersData);
          setFilteredInsurers(defaultInsurersData);
        }
      } else {
        setAllInsurers(defaultInsurersData);
        setFilteredInsurers(defaultInsurersData);
      }
    };

    fetchInsurers();
  }, [token, refreshTrigger]);

  const handleCardClick = (insurerClicked) => {
    const foundInsurer = allInsurers.find(ins => ins.companyName === insurerClicked.companyName);
    setSelectedInsurer(foundInsurer || insurerClicked);
    setFormData({
      userName: foundInsurer?.userName || '',
      password: '',
      confirmPassword: '',
      companyName: foundInsurer?.companyName || '',
    });
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setSelectedInsurer(null);
    setFormData({ userName: '', password: '', confirmPassword: '', companyName: '' });
  };

  const handleFormChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      toast.error('No se pudo realizar la acción. No hay token de autenticación.');
      return;
    }

    if (selectedInsurer?.userName) {
      // Update existing insurer (only username is available from get)
      try {
        const updateData = {};
        if (formData.password) {
          updateData.password = formData.password;
          updateData.userName = formData.userName
        }
        const updatedData = await updateInsurer(selectedInsurer.companyName, updateData, token);
        setAllInsurers(prevInsurers =>
          prevInsurers.map(insurer =>
            insurer.companyName === selectedInsurer.companyName
              ? { ...insurer, ...updateData }
              : insurer
          )
        );
        setFilteredInsurers(prevInsurers =>
          prevInsurers.map(insurer =>
            insurer.companyName === selectedInsurer.companyName
              ? { ...insurer, ...updateData }
              : insurer
          )
        );
        toast.success(`Se actualizó correctamente la información de ${selectedInsurer.companyName}`);
        handleModalClose();
        console.log('Insurer updated:', updatedData);
      } catch (error) {
        console.error('Error updating insurer:', error);
        toast.error(`No se pudo actualizar la información de ${selectedInsurer.companyName}`);
      }
    } else {
      // Create new insurer
      if (!formData.password || formData.password !== formData.confirmPassword) {
        toast.error('Las contraseñas no coinciden.');
        return;
      }
      try {
        const newInsurerData = {
          companyName: formData.companyName,
          userName: formData.userName,
          password: formData.password,
        };
        const createdInsurer = await createInsurer(newInsurerData, token);
        setAllInsurers(prevInsurers => [...prevInsurers, createdInsurer]);
        setFilteredInsurers(prevInsurers => [...prevInsurers, createdInsurer]);
        toast.success(`Se agregó correctamente ${formData.companyName}`);
        setRefreshTrigger(prev => prev + 1);
        handleModalClose();
        console.log('Insurer created:', createdInsurer);
      } catch (error) {
        console.error('Error creating insurer:', error);
        toast.error(`No se pudo agregar ${formData.userName}`);
      }
    }
  };

  const handleDelete = async () => {
    if (!token || !selectedInsurer) {
      toast.error('No se pudo realizar la eliminación. No hay token o aseguradora seleccionada.');
      return;
    }

    try {
      await deleteInsurer(selectedInsurer.companyName, token);
      const updatedInsurers = allInsurers.map(insurer =>
        insurer.companyName === selectedInsurer.companyName ? { ...insurer, userName: '' } : insurer
      );
      setAllInsurers(updatedInsurers);
      setFilteredInsurers(updatedInsurers);
      toast.success(`Se borró la información de usuario de ${selectedInsurer.companyName}`);
      setRefreshTrigger(prev => prev + 1);
      handleModalClose();
      console.log('Insurer deleted from backend:', selectedInsurer.companyName);
    } catch (error) {
      console.error('Error al eliminar la aseguradora del backend:', error);
      toast.error(`No se pudo eliminar la información de usuario de ${selectedInsurer.companyName} `);
    }
  };

  const handleSearchChange = (e) => {
    const value = e.target.value.toLowerCase();
    setSearchText(value);
    const filtered = allInsurers.filter(insurer =>
      insurer.companyName.toLowerCase().includes(value)
    );
    setFilteredInsurers(filtered);
  };

  return (
    <>
     {isMobile?
        <>
          
    <MobileHeader/>
        
        </>
        :
        <></>
      }
      <Navbar />
      <Box sx={{
    padding: '20px',
    height: 'calc(100vh - 64px)',
    overflowY: 'auto',
    margin: 0, // Añade esto
    paddingBottom: '20px', // Asegúrate de tener un padding inferior para ver el último elemento
  }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ fontSize: isMobile ? "25px" : "25px", color: "purple", marginTop: "10px" , display:"flex", justifyContent:"center"}}>
            Aseguradoras
          </h1>
        </Box>
        <Box sx={{ marginBottom: '20px', width: isMobile ? '100%' : '50%', marginX: 'auto' }}>
          <TextField
            fullWidth
            label="Buscar por nombre"
            variant="outlined"
            value={searchText}
            onChange={handleSearchChange}
            InputLabelProps={{
              style: {
                color: 'black', // Establece el color del label a negro (cuando no está enfocado)
              },
            }}
            InputProps={{
              style: {
                color: 'black', // Establece el color del texto del input
              },
            }}
          />
        </Box>
        <Box sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '20px',
          marginTop: "30px",
        }}>
          {filteredInsurers.map((insurer) => (
            <InsurerCard
              key={insurer.id}
              insurer={insurer}
              onClick={handleCardClick}
              width={isMobile ? '100%' : '30%'}
            />
          ))}
          {filteredInsurers.length === 0 && (
            <Typography sx={{ width: '100%', textAlign: 'center', mt: 2 }}>
              No se encontraron aseguradoras con el nombre "{searchText}"
            </Typography>
          )}
        </Box>
        <InsurerFormModal
          open={modalOpen}
          onClose={handleModalClose}
          formData={formData}
          onChange={handleFormChange}
          onSubmit={handleFormSubmit}
          onDelete={handleDelete}
          selectedInsurer={selectedInsurer}
        />
        <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} newestOnTop closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover theme="light" />
      </Box>
    </>
  );
};

export default InsurersScreen;