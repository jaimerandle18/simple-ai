import React from "react";
import { useNavigate } from "react-router-dom";
import SimpleAI from '../assets/SimpleWhiteAI.png';
import Logo from '../assets/simpleLogo.webp';
import { useMediaQuery } from "@mui/material";
import image from "../assets/backgorundSimple.png"
import "../dashboard/userStadistics.css"

export const MobileHeader=()=>{
    const navigate = useNavigate()
    const isMobile = useMediaQuery('(max-width:600px)');

    return(
    <div onClick={()=>navigate('/home')} className={'dashContainer'} style={{height:"50px", display:"flex", justifyContent:"center"}}>
    <img src={Logo}  style={{width:"9%", height:"29px", zIndex:1111111, position:"relative", marginTop:"10px"}}/>
    <img src={SimpleAI} style={{width:"25%", height:"20px", position:"relative", marginTop:"16px", marginLeft:"15px"}}/>
  </div>)
}