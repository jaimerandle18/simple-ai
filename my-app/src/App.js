import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, useNavigate } from 'react-router-dom';
import Login from './Login/login';
import Home from './Home/Home';
import SimpleTable from './components/multiTable';
import ConversationDetails from './conversations/ConversationDetails';
import UserInfo from './userInfo/userInfo';
import UserStats from './dashboard/userStadistics';
import { setupInterceptors } from './services/apiClient';
import ChatPrueba from './ChatPrueba/chatPrueba';
import CampañaScreen from './Remarketing/CampScreen';
import InsurersScreen from './Seguros/insurersScreen';


const App= () => {
    setupInterceptors(Navigate);
    return (
        <Router>
            <Routes>
                <Route path="/" element={<Login />} />
                <Route path="/home" element={<Home />} />
                <Route path="*" element={<Navigate to="/" />} />
                <Route path="/conversation/:id" element={<ConversationDetails />} />
                <Route path="/conversations" element={<SimpleTable />} />
                <Route path="/Perfil" element={<UserInfo />}/>
                <Route path="/dashboard" element={ <UserStats />}/>
                <Route path="/chatTest" element={ <ChatPrueba />}/>
                <Route path="/remarketing" element={ <CampañaScreen />}/>
                <Route path="/Seguros" element={ <InsurersScreen />}/>
            </Routes>
        </Router>
    );
}

export default App;
