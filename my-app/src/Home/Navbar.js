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
import MenuIcon from '@mui/icons-material/Menu';
import SecurityIcon from '@mui/icons-material/Security';
import './Navbar.css';

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
        <div className={isMobile ? "navbar-mobile-container" : "navbar-desktop-container"}>
            <nav className="navbar" >
                <div className="navbar-content" style={{display: isMobile ? "" : "flex"}}>
                    <div className="navbar-brand-container" style={{ display: isMobile ? 'none' : 'flex' }}>
                        <img className="logo-simple" src={SimpleLogo} alt="Simple Logo" />
                        <img className="logo-ai" src={simpleAi} alt="Simple AI" onClick={() => navigate("/home")} />
                    </div>
                    {!isMobile ?
                        <div className="welcome-desktop">
                            <PersonIcon className="welcome-icon" />
                            <p className="welcome-text">Bienvenido, <strong>{name}</strong>!</p>
                        </div>
                        : <></>}
                    {!isMobile ?
                        <div className="menu-toggle-desktop" onClick={toggleSidebar}>
                            <MenuIcon className="menu-icon" />
                        </div>
                        :
                        <div className="navbar-mobile-actions">
                            <div className="mobile-icons">
                                <Tooltip title="Home">
                                    <HomeIcon className="mobile-icon" onClick={() => navigate("/Home")} />
                                </Tooltip>
                                <Tooltip title="Configurar asistente">
                                    <SettingsSuggestTwoToneIcon className="mobile-icon" onClick={() => navigate("/ChatTest")} />
                                </Tooltip>
                                <Tooltip title="Perfil">
                                    <PersonIcon className="mobile-icon" onClick={() => navigate("/Perfil")} />
                                </Tooltip>
                                <a onClick={() => { navigate("/Seguros"); setIsSidebarOpen(false); }}>
                            <SecurityIcon className="sidebar-icon" /> 
                        </a>
                                <Tooltip title="Dashboard">
                                    <EqualizerIcon className="mobile-icon" onClick={() => navigate("/dashboard")} />
                                </Tooltip>
                            </div>
                            <div className="mobile-logout">
                                <Tooltip title="Cerrar sesión">
                                    <LogoutIcon className="mobile-icon" onClick={handleLogout} />
                                </Tooltip>
                            </div>
                        </div>
                    }
                </div>
            </nav>

            {!isMobile && isSidebarOpen && <div className="sidebar-overlay open" onClick={toggleSidebar}></div>}

            {!isMobile && (
                <div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                    <div className="sidebar-content">
                        <div className="sidebar-header">
                            <p className="sidebar-title">Menú</p>
                            <button onClick={toggleSidebar} className="close-sidebar">X</button>
                        </div>
                        <a onClick={() => { navigate("/Home"); setIsSidebarOpen(false); }}>
                            <HomeIcon className="sidebar-icon" /> <span className="sidebar-link-text">Home</span>
                        </a>
                        <a onClick={() => { navigate("/ChatTest"); setIsSidebarOpen(false); }}>
                            <SettingsSuggestTwoToneIcon className="sidebar-icon" /> <span className="sidebar-link-text">Configurar asistente</span>
                        </a>
                        <a onClick={() => { navigate("/Seguros"); setIsSidebarOpen(false); }}>
                            <SecurityIcon className="sidebar-icon" /> <span className="sidebar-link-text">Mis Companias de seguros</span>
                        </a>
                        <a onClick={() => { navigate("/Perfil"); setIsSidebarOpen(false); }}>
                            <PersonIcon className="sidebar-icon" /> <span className="sidebar-link-text">Perfil</span>
                        </a>
                        <a onClick={() => { navigate("/remarketing"); setIsSidebarOpen(false); }}>
                            <ReplyAllIcon className="sidebar-icon" /> <span className="sidebar-link-text">Seguimiento</span>
                        </a>
                        <a onClick={() => { navigate("/dashboard"); setIsSidebarOpen(false); }}>
                            <EqualizerIcon className="sidebar-icon" /> <span className="sidebar-link-text">Dashboard</span>
                        </a>
                        <a onClick={() => { handleLogout(); setIsSidebarOpen(false); }}>
                            <LogoutIcon className="sidebar-icon" /> <span className="sidebar-link-text">Cerrar sesión</span>
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Navbar;