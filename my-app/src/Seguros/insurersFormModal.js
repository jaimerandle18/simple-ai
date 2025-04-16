import React, { useState } from 'react';
import { Modal, Box, TextField, Button, Typography, Avatar } from '@mui/material';

const InsurerFormModal = ({ open, onClose, formData, onChange, onSubmit, onDelete, selectedInsurer }) => {
  const [showPasswordFields, setShowPasswordFields] = useState(false);

  const handleTogglePasswordFields = () => {
    setShowPasswordFields(!showPasswordFields);
  };

  const isEditingWithUsername = !!selectedInsurer?.username;
  const isCreatingNew = !selectedInsurer?.username;
  const buttonText = isEditingWithUsername && showPasswordFields ? 'Actualizar Contraseña' : 'Guardar';

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{ position: 'absolute', top: isEditingWithUsername? "50%": "57%", left: '50%', transform: 'translate(-50%, -50%)', width: 400, bgcolor: 'background.paper', boxShadow: 24, p: 4 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 2 }}>
          {selectedInsurer?.imageUrl ? (
            <Avatar src={selectedInsurer.imageUrl} alt={selectedInsurer.name} sx={{ width: 80, height: 80, mb: 1 }} />
          ) : (
            <Avatar sx={{ width: 80, height: 80, bgcolor: 'primary.main', color: 'white', fontSize: '1.5rem', mb: 1 }}>
              {selectedInsurer?.name?.charAt(0).toUpperCase()}
            </Avatar>
          )}
          <Typography variant="h6">{selectedInsurer ? `Editar ${selectedInsurer.name}` : `Agregar aseguradora`}</Typography>
        </Box>
        <form onSubmit={onSubmit}>
          {!selectedInsurer && (
            <TextField
              label="Nombre de la Aseguradora"
              name="name"
              value={formData.name}
              onChange={onChange}
              fullWidth
              margin="normal"
              required
              InputLabelProps={{ style: { color: 'rgba(0, 0, 0, 0.6)' } }}
            />
          )}
          <TextField
            label="Email"
            name="username"
            value={formData.username}
            onChange={onChange}
            fullWidth
            margin="normal"
            required
            InputLabelProps={{ style: { color: 'rgba(0, 0, 0, 0.6)' } }}
          />

          {/* Campos de contraseña para creación o si se activan en edición */}
          {isCreatingNew || (isEditingWithUsername && showPasswordFields) ? (
            <>
              <TextField
                label="Contraseña"
                name="password"
                type="password"
                value={formData.password}
                onChange={onChange}
                fullWidth
                margin="normal"
                required={isCreatingNew || showPasswordFields}
                InputLabelProps={{ style: { color: 'rgba(0, 0, 0, 0.6)' } }}
              />
              {isCreatingNew && (
                <TextField
                  label="Confirmar Contraseña"
                  name="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={onChange}
                  fullWidth
                  margin="normal"
                  required={isCreatingNew}
                  InputLabelProps={{ style: { color: 'rgba(0, 0, 0, 0.6)' } }}
                />
              )}
            </>
          ) : (isEditingWithUsername && (
            <Button onClick={handleTogglePasswordFields} sx={{ mt: 2 }}>
              Actualizar Contraseña
            </Button>
          ))}

          <Box sx={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={isCreatingNew && formData.password !== formData.confirmPassword}
            >
              {buttonText}
            </Button>
            {selectedInsurer && (
              <Button onClick={onDelete} variant="contained" color="error">
                Eliminar
              </Button>
            )}
          </Box>
          {isCreatingNew && formData.password !== formData.confirmPassword && (
            <Typography color="error" sx={{ mt: 1 }}>
              Las contraseñas no coinciden.
            </Typography>
          )}
        </form>
      </Box>
    </Modal>
  );
};

export default InsurerFormModal;