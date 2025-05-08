import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from './Navbar';
import 'bootstrap/dist/css/bootstrap.min.css';
import './Home.css';
import SimpleTable from '../components/multiTable';
import { getAssistants, getUserInfo } from '../services/bffService';
import { Box, useMediaQuery, } from '@mui/material';
import Loading from '../components/Loading';
import SimpleAI from '../assets/SimpleWhiteAI.png'
import Logo from '../assets/simpleLogo.webp'
import { MobileHeader } from '../components/mobileHeader';

const Home = () => {
    const [userName, setUserName] = useState('');
    const [newColumns, setNewColumns] = useState('');
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const isMobile = useMediaQuery('(max-width:600px)');

    useEffect(() => {
        const fetchUserDetails = async () => {
            const token = localStorage.getItem('authToken');
            if (!token) {
                localStorage.clear(); // Limpia todo el localStorage
                sessionStorage.clear(); // Limpia todo el sessionStorage
                navigate('/');
            } else {
                try {
                    const userDetails = await getUserInfo(token);
                    const assistantsData = await getAssistants(token);
                    sessionStorage.setItem("asistentes", JSON.stringify(assistantsData.sort((a, b) => a.id - b.id)));
                    setNewColumns(userDetails.clientInfo.details)
                    setUserName(userDetails.name); // Assuming the user details have a 'name' field
                } catch (error) {
                    console.error('Error fetching user details:', error);
                    navigate('/');
                } finally {
                    setLoading(false);
                }
            }
        };

        fetchUserDetails();
    }, [navigate]);

    console.log(newColumns, "NEWCOLUMNS")

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' , backgroundColor:"white"}}>
                <Loading />
            </Box>
        );
    }

    return (
        <>
            <div className={isMobile?"":""} style={{margin:'0px',height:isMobile?"":"100%",display:"flex",flexDirection:isMobile?"column-reverse":"column",alignContent:"space-between", backgroundColor:"white !important", zIndex:9999999}}>
                <Navbar />
                <div style={{height: '100%',zIndex:isMobile?"2":"" ,background:"white",borderRadius:isMobile?"10px 10px 0px 0px":""}}>
                    <div className="d-flex" id={!isMobile?"wrapper":""}  style={{height: isMobile? "300vh" : ""}}>
                        <div id="page-content-wrapper" className="w-100">
                            <div classname="roboto-medium"> 
                                <div className="container-fluid px-4">
                                    <div className="row justify-content-center">
                                        <SimpleTable customerDetails={newColumns} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {isMobile?
                    <MobileHeader/>
                    :
                    <></>
                }
            </div>
            
        </>
    );
};

export default Home;
