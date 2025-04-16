import React, { useEffect, useState } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import simpleAi from '../assets/SimpleWhiteAI.png';
import SimpleLogo from '../assets/simpleLogo.webp';
import PersonIcon from '@mui/icons-material/Person';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import LogoutIcon from '@mui/icons-material/Logout';
import { Tooltip, useMediaQuery } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import SettingsSuggestTwoToneIcon from '@mui/icons-material/SettingsSuggestTwoTone';
import ReplyAllIcon from '@mui/icons-material/ReplyAll';
import HomeIcon from '@mui/icons-material/Home';
import MenuIcon from '@mui/icons-material/Menu'; // Importa el icono de menú
import SecurityIcon from '@mui/icons-material/Security';
import './Navbar.css'; // Asegúrate de que este archivo CSS exista y contenga los estilos

const Navbar = () => {
    const navigate = useNavigate();
    const [name, setName] = useState("");
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const isMobile = useMediaQuery('(max-width:600px)');

    const handleLogout = () => {
        localStorage.clear();
        sessionStorage.clear();
        navigate('/');
    };

    const toggleSidebar = () => {
        setIsSidebarOpen(!isSidebarOpen);
    };

    useEffect(() => {
        const info = JSON.parse(localStorage.getItem('userInfo'));
        setName(info?.name || "");
    }, []);

    return (
        <div className={isMobile ? "" : "NAVBAR"} style={{ backgroundColor: isMobile ? "white" : "white", position: isMobile ? "fixed" : "", zIndex: "9999", width: isMobile ? "100%" : "", bottom: isMobile ? 0 : "", height: isMobile ? "45px" : "", marginTop: !isMobile ? "0px" : "" }}>
            <nav className="navbar navbar-expand-lg navbar-light bg-light" style={{ backgroundColor: 'white' }}>
                <div className="container-fluid">
                    <div className="navbar-brand" style={{ display: isMobile ? 'none' : 'flex', alignItems: 'center' }}>
                        <img style={{ height: '30px', width: '30px', marginLeft: '10px', marginTop: '5px' }} src={SimpleLogo} alt="Simple Logo" />
                        <img style={{ width: isMobile ? "70px" : '130px', marginTop: '10px', marginLeft: '10px', cursor: 'pointer' }} src={simpleAi} alt="Simple AI" onClick={() => navigate("/home")} />
                    </div>
                    {!isMobile ?
                        <div style={{ display: 'flex', marginTop: "20px", marginLeft:"-150px" }}>
                            <PersonIcon style={{ color: "white" }} />
                            <p style={{ color: "white", marginLeft: "5px" }}>Bienvenido, <strong>{name}</strong>!</p>
                        </div>
                        : <></>}
                    {!isMobile ?
                        <div className="ml-auto" style={{ display: 'flex', alignItems: 'center' }}>
                            <div className="sidebar-toggle" onClick={toggleSidebar} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'white' }}>
                                <MenuIcon style={{ height: '30px', width: '30px' }} />
                            </div>
                        </div>
                        :
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', position: "fixed", bottom: "0" }}>
                            <div style={{ flex: '4', display: 'flex', gap: '25px' }}>
                                <a className="nav-link user-icon-wrapper" >
                                    <Tooltip title="Home" >
                                        <HomeIcon style={{ height: '30px', width: '30px', cursor: "pointer", color: "grey" }} onClick={() => navigate("/Home")} />
                                    </Tooltip>
                                </a>
                                <a className="nav-link user-icon-wrapper">
                                    <Tooltip title="Config asistant" >
                                        <SettingsSuggestTwoToneIcon style={{ height: '30px', width: '30px', cursor: "pointer", color: "grey" }} onClick={() => navigate("/ChatTest")} />
                                    </Tooltip>
                                </a>
                                <a className="nav-link user-icon-wrapper">
                                    <Tooltip title="Perfil">
                                        <PersonIcon style={{ height: '30px', width: '30px', cursor: "pointer", color: "grey" }} onClick={() => navigate("/Perfil")} />
                                    </Tooltip>
                                </a>
                                <a className="nav-link user-icon-wrapper">
                                    <Tooltip title="Dashboard">
                                        <EqualizerIcon style={{ height: '30px', width: '30px', cursor: "pointer", color: "grey" }} onClick={() => navigate("/dashboard")} />
                                    </Tooltip>
                                </a>
                            </div>
                            <div style={{ flex: '1', display: 'flex', alignItems: "center", justifyContent: 'center' }}>
                                <a className="nav-link user-icon-wrapper">
                                    <Tooltip title="Cerrar sesión">
                                        <LogoutIcon style={{ height: '30px', width: '30px', cursor: "pointer", color: "grey" }} onClick={handleLogout} />
                                    </Tooltip>
                                </a>
                            </div>
                        </div>
                    }
                </div>
            </nav>

            {!isMobile && (
                <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                    <div className="sidebar-content">
                        <div className="sidebar-header">
                            <p>Menú</p>
                            <button onClick={toggleSidebar} className="close-sidebar">X</button>
                        </div>
                        <a onClick={() => { navigate("/Home"); setIsSidebarOpen(false); }}>
                            <HomeIcon /> Home
                        </a>
                        <a onClick={() => { navigate("/ChatTest"); setIsSidebarOpen(false); }}>
                            <SettingsSuggestTwoToneIcon /> Configura tu asistente
                        </a>
                        <a onClick={() => { navigate("/Seguros"); setIsSidebarOpen(false); }}>
                            <SecurityIcon /> Mis Companias de seguros
                        </a>
                        <a onClick={() => { navigate("/Perfil"); setIsSidebarOpen(false); }}>
                            <PersonIcon /> Perfil
                        </a>
                        <a onClick={() => { navigate("/remarketing"); setIsSidebarOpen(false); }}>
                            <ReplyAllIcon /> Remarketing
                        </a>
                        <a onClick={() => { navigate("/dashboard"); setIsSidebarOpen(false); }}>
                            <EqualizerIcon /> Dashboard
                        </a>
                        <a onClick={() => { handleLogout(); setIsSidebarOpen(false); }}>
                            <LogoutIcon /> Cerrar sesión
                        </a>
                    </div>
                </div>
            )}

            {!isMobile && isSidebarOpen && <div className="sidebar-overlay" onClick={toggleSidebar}></div>}
        </div>
    );
};

export default Navbar;