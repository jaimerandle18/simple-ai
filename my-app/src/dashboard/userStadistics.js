import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { Box, Typography, CircularProgress, Button, ButtonGroup, useMediaQuery,List,ListItem,ListItemIcon ,ListItemText} from '@mui/material';
import { getConversations } from '../services/bffService';
import Navbar from '../Home/Navbar';
import { useNavigate } from 'react-router-dom';
import Loading from '../components/Loading';
import Listado from "../assets/Listado.png";
import "./userStadistics.css";
import SimpleAI from '../assets/SimpleWhiteAI.png';
import Logo from '../assets/simpleLogo.webp';
import ListAltIcon from '@mui/icons-material/ListAlt';
import MessageIcon from '@mui/icons-material/Message';
import SettingsIcon from '@mui/icons-material/Settings';
import mercadoLibre from "../assets/meli.png";
import { Card } from 'react-bootstrap';
import { Instagram, WhatsApp } from '@mui/icons-material';



const COLORS = {
  'WhatsApp':  '#8D39BB',
  'Mercado Libre': '#ffe600',
  'Instagram': '#833ab4',
  'Otro': '#8D39BB'
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const channel = payload[0].name;
    const color = COLORS[channel];
    const background = COLORS[channel]
    return (
      <div style={{ backgroundColor: '#333', color: 'white', padding: '10px', borderRadius: '5px' }}>
        <p style={{ margin: 0, color  }}>{label}</p>
        <p style={{ margin: 0 }}>{`${channel}: ${payload[0].value}`}</p>
      </div>
    );
  }

  return null;
};

const CustomLegend = ({ payload }) => (
  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
    {payload.map((entry, index) => (
      <div key={`item-${index}`} style={{ margin: '5px 10px', display: 'flex', alignItems: 'center' }}>
        <div style={{
          width: 10,
          height: 10,
          backgroundColor: entry.color,
          border: '1px solid #b0b0b0',
          marginRight: 5
        }} />
        <span style={{ color: '#b0b0b0' }}>{entry.value}</span>
      </div>
    ))}
  </div>
);

const UserStats = () => {
  const [data, setData] = useState([]);
  const [weeklyData, setWeeklyData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('overall'); // 'overall' or 'weekly'
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width:750px)');
  

  useEffect(() => {
    const fetchConversations = async () => {
      const token = localStorage.getItem('authToken');
      if (!token) {
        localStorage.clear(); // Limpia todo el localStorage
        sessionStorage.clear(); // Limpia todo el sessionStorage
        navigate('/');
      } else {
        try {
          const conversations = await getConversations(token);
          
          // Overall data
          const platformCounts = {
            'WhatsApp': 0,
            'Mercado Libre': 0,
            'Instagram': 0,
            'Demo':0
          };
          
          // Weekly data
          const last7Days = {};
          for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateString = date.toISOString().split('T')[0];
            last7Days[dateString] = { 'WhatsApp': 0, 'Mercado Libre': 0, 'Instagram': 0, 'Demo':0};
          }

          // Count conversations
          conversations.forEach(conversation => {
            const date = new Date(conversation.last_updated).toISOString().split('T')[0];
            const channel = conversation.channel_type === 3 ? 'Mercado Libre' :
                            conversation.channel_type === 4 || 1 ? 'WhatsApp' :
                            conversation.channel_id === 11 ? 'Instagram' : 
                            conversation.channel_id === 6? "Demo": ""
            
            if (platformCounts[channel] !== undefined) {
              platformCounts[channel]++;
            }

            if (last7Days[date] && last7Days[date][channel] !== undefined) {
              last7Days[date][channel]++;
            }
          });

          const overallChartData = Object.entries(platformCounts).map(([name, value]) => ({ name, value }));
          const weeklyChartData = Object.entries(last7Days).map(([date, counts]) => ({
            date,
            ...counts,
          }));

          setData(overallChartData);
          setWeeklyData(weeklyChartData);
        } catch (error) {
          setError(error.message);
        } finally {
          setLoading(false);
        }
      }
    };

    fetchConversations();
  }, [navigate]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Loading />
      </Box>
    );
  }

  return (
    <>
      <Navbar/> 
    <div className={isMobile?"dashContainer":""} style={{ height:isMobile?'100vh':'100vh' , overflowY: 'auto' ,display:"flex",flexDirection:isMobile?"column-reverse":"column"}} >
          {
            isMobile?
            <></>
            :
            <>
            <div className="header-container" style={{marginLeft:"5%", marginTop:"0px"}}>
              <h1 style={{fontSize:"30px", color:"grey", marginTop:"10px"}}>Dashboard de tus productos</h1>
              <Button style={{display:"flex", width:"20%", border:"1px solid #ADB0CD", height:"50px"}}  onClick={()=>{navigate("/home")}}>
              <img src={Listado} alt="" style={{ height:"20px"}}/>
              { isMobile? <></> : <p style={{color:"grey", marginTop:"20px", marginLeft:"5px", fontSize:"15px"}}>Volver al dashboard</p>}
              </Button>
          </div>
          <div style={{border:"0.5px solid #9747FF", marginTop:"20px", width:"90%", marginLeft:"5%"}}></div>
            </>
            
          }
        
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'center',
          minHeight: '75vh',
          overflowY: 'auto',
          marginTop: "0px",
          paddingBottom: "100px",
          padding: '16px',
          backgroundColor:'white',
          zIndex:"2",
          borderRadius:"10px 10px 0px 0px"
        }}
      >
        {isMobile?
          <Box marginBottom="8%" marginTop="2%">
            <Typography variant='h5'fontWeight="bold" align='center'>Dashboard de tus productos</Typography>
            <Box sx={{display:"flex",justifyContent:"space-between",gap:"30px",marginTop:"20px",alignItems:"center"}}>
                <Box sx={{display:"flex",justifyContent:"space-between",gap:"10px"}}>
                  <Typography>Canal:</Typography>
                  <WhatsApp/>
                  <Instagram/>
                  <img src={mercadoLibre} style={{width:"20%", height:"60%"}}/>
                </Box>
                  <Button style={{display:"flex", width:"20%", border:"1px solid #ADB0CD", height:"50px"}}  onClick={()=>{navigate("/home")}}>
                <img src={Listado} alt="" style={{ height:"20px"}}/>
                { isMobile? <></> : <p style={{color:"grey", marginTop:"20px", marginLeft:"5px", fontSize:"15px"}}>Volver al dashboard</p>}
                </Button>
            </Box>
          </Box>
        :  
          <></>
        }


        <Box sx={{display:"none"}}>
          <Box sx={{display:"flex"}}>
              <ListItem sx={{display:"flex",flexDirection:"column" ,justifyContent:"center"}}>
                <ListItemIcon sx={{display:"flex",justifyContent:"center"}} >
                  <ListAltIcon color='grey' sx={{fontSize:"35px"}} />
                </ListItemIcon>
                <ListItemText primary="Listas"/>
              </ListItem>
               
              <ListItem sx={{display:"flex",flexDirection:"column"}}>
                <ListItemIcon sx={{display:"flex",justifyContent:"center"}}>
                  <MessageIcon color='grey'  sx={{fontSize:"35px"}} />
                </ListItemIcon>
                <ListItemText primary="Mensajes"/>
              </ListItem>
              
              <ListItem sx={{display:"flex",flexDirection:"column",textAlign:"center"}}>
                <ListItemIcon sx={{display:"flex",justifyContent:"center"}} >
                  <SettingsIcon color='grey'   sx={{fontSize:"35px"}}/>
                </ListItemIcon>
                <ListItemText primary="Ajustes"/>
              </ListItem>
          </Box>
        </Box>
        
          <ButtonGroup variant="contained" sx={{boxShadow:"none", marginBottom: 2, marginTop:4, display:"flex", flexWrap:"wrap", width:isMobile?"100%":"40%", justifyContent:isMobile?"space-evenly":"space-between"}}>
            <Button onClick={() => setView('overall')}  style={{color: view === 'overall' ? 'white' : 'grey' , backgroundColor: view === 'overall' ? '#969AB8' : 'white',  border: view === 'overall' ? '' : '1px solid #969AB8', borderRadius:"5px"}}>Vista General</Button>
            <Button onClick={() => setView('weekly')} style={{color: view === 'weekly' ? 'white' : 'grey' , backgroundColor: view === 'weekly' ? '#969AB8' : 'white', border: view === 'weekly' ? '' : '1px solid #969AB8', borderRadius:"5px"}}>Últimos 7 Días</Button>
          </ButtonGroup>
          <Box sx={{ width: '100%',maxWidth:isMobile?"90%":"60%", marginBottom: '140px'}}>
            {error ? (
              <Typography variant="body1" color="error">{error}</Typography>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                {view === 'overall' ? (
                  <BarChart
                    data={data}
                    margin={{ top: 20, right: isMobile ? 30 : 15, left: isMobile ? -10 : -25, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="white" />
                    <XAxis 
                      dataKey="name" 
                      stroke="#b0b0b0" 
                      tick={{ angle: isMobile ? -50 : 0, textAnchor: isMobile ? 'end' : 'middle' }} 
                      height={isMobile ? 60 : undefined} 
                      interval={0}
                    />
                    <YAxis stroke="#b0b0b0" />
                    <Tooltip cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }} contentStyle={{ backgroundColor: '#333', color: 'white' }} content={CustomTooltip} />
                    <Legend content={CustomLegend} wrapperStyle={{ bottom: isMobile ? "-20px" : 0, display: 'block' , textAlign: 'center' }} />
                    <Bar dataKey="value" >
                      {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[entry.name]} strokeLinecap="none" stroke="white" strokeWidth={0} />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <BarChart
                    data={weeklyData}
                    margin={{ top: 20, right: isMobile ? 30 : 15, left: isMobile ? -10 : -25, bottom: 5  }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="white" />
                    <XAxis 
                      dataKey="date" 
                      stroke="white" 
                      tick={{ angle: isMobile ? -50 : 0, textAnchor: isMobile ? 'end' : 'middle' }} 
                      height={isMobile ? 60 : undefined} 
                      interval={0}
                    />
                    <YAxis stroke="#b0b0b0" />
                    <Tooltip cursor={{ fill: 'rgba(255, 255, 255, 0.1)' }} contentStyle={{ backgroundColor: '#333', color: '#b0b0b0' }} />
                    <Legend content={CustomLegend} wrapperStyle={{ bottom: isMobile ? "-20px" : 0, display: 'block', textAlign:  'center'}} />
                    <Bar dataKey="WhatsApp" stackId="a" fill="#8D39BB" stroke="#b0b0b0" strokeWidth={1} />
                    <Bar dataKey="Mercado Libre" stackId="a" fill="#ffe600" stroke="#b0b0b0" strokeWidth={1} />
                    <Bar dataKey="Instagram" stackId="a" fill="#833ab4" stroke="#b0b0b0" strokeWidth={1} />
                    <Bar dataKey="Demo" stackId="a" fill="#8D39BB" stroke="#b0b0b0" strokeWidth={1} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            )}
          </Box>
         
      </Box>
      
      {isMobile?
        <>
          
          <div style={{zIndex:"2", margin:"auto",display:"flex",alignItems:"center",marginTop:"10%", gap:"20px",marginBottom:"10%"}}>
            <img src={Logo}  style={{width:"30%"}}/>
            <img src={SimpleAI} style={{width:"90%"}}/>
          </div>
      
        </>
        :
        <></>
      }
      </div>
   
    </>
  );
};

export default UserStats;
