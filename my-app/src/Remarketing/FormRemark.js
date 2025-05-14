import { useEffect, useState } from "react";
import { Button, TextField, Select, MenuItem, FormControl, FormControlLabel, Switch, Snackbar, Alert, Typography, Box } from "@mui/material"; 
import { getPeriodicJobs, postPeriodicJob } from "../services/bffService"; // Asegúrate de tener esto correctamente importado
import Loading from "../components/Loading";

const Formulario = () => {
  const [daysWaitingExecution, setDaysWaitingExecution] = useState("1");
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null); // Mensaje de feedback
  const [openSnackbar, setOpenSnackbar] = useState(false); // Control del Snackbar
  const token = localStorage.getItem('authToken');

  useEffect(() => {
    const cargarParametros = async () => {
      try {
        const data = await getPeriodicJobs(token);
        console.log("Datos recibidos:", data); // Verificar los datos que devuelve la API
        setDaysWaitingExecution(data[0].daysWaitingExecution || "1");
        setPrompt(data[0]?.prompt || "");
        setEnabled(data[0].enabled ?? false);
      } catch (error) {
        console.error("Error al cargar parámetros:", error);
      } finally {
        setLoading(false);
      }
    };

    cargarParametros();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = {
      daysWaitingExecution,
      prompt,
      enabled,
    };

    try {
      await postPeriodicJob(token, payload);
      setMessage("Instrucciones enviadas correctamente");
      setOpenSnackbar(true); // Mostrar el Snackbar
    } catch (error) {
      console.error("No pudimos enviar las instrucciones", error);
      setMessage("No pudimos enviar las instrucciones");
      setOpenSnackbar(true); // Mostrar el Snackbar
    }
  };

  const handleCloseSnackbar = () => {
    setOpenSnackbar(false);
  };

  if (loading) {
    return <div><Loading/></div>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" style={{ maxWidth: "600px", margin: "0 auto" }}>
      <Typography variant="body1" paragraph style={{ marginTop: "20px" }}>
        En esta sección podés configurar que el asistente retome chats inconclusos después de cierta cantidad de días, enfocándose en las instrucciones que le indiques.
      </Typography>

      <Box display="flex" alignItems="center" flexWrap="wrap" gap={2}>
        <Typography variant="body1" component="span">
          Retomar conversaciones después de: 
        </Typography>

        <FormControl size="small" sx={{ minWidth: 120 }}>
          <Select
            value={daysWaitingExecution}
            onChange={(e) => setDaysWaitingExecution(e.target.value)}
            label="Días de espera"
            sx={{
              "& .MuiSelect-select": {
                paddingLeft: 1,
                paddingRight: 1,
              },
              "& .MuiOutlinedInput-notchedOutline": {
                border: "none",
              },
              minWidth: 100,
            }}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((day) => (
              <MenuItem key={day} value={day.toString()}>
                {day} día{day > 1 ? "s" : ""}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
      <br></br>
      <Box>
        <TextField
          label="Instrucciones de seguimiento"
          id="prompt"
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          fullWidth
           InputLabelProps={{
      style: {
        color: "grey", // Asegura que el color del label sea negro o el color que desees
      }  // Asegura que el label esté siempre visible
    }}
          variant="outlined"
          placeholder="Escribe las instrucciones de seguimiento"
          helperText="Ejemplo: 'Recuerda al usuario sobre la oferta que dejó pendiente.'"
          multiline
          minRows={4}  // Esto asegura que el texto comienza en la parte superior
          sx={{
            "& .MuiFormHelperText-root": {
              color: "#9c27b0", // Color violeta/rosado
            },
            "& .MuiOutlinedInput-root": {
              borderRadius: "4px", // Aseguramos bordes redondeados en todos los dispositivos
              height: "auto"  // Ajuste automático de la altura
            },
            minHeight: "120px", // Mayor altura para el campo de instrucciones
            maxWidth: "100%", // Ajustar al ancho disponible
          }}
        />
      </Box>

      <Box display="flex" justifyContent="center" alignItems="center" marginBottom={2}>
        <FormControlLabel
          control={
            <Switch
              id="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          }
          label="Habilitado"
        />
      </Box>

      <Box display="flex" justifyContent="center" marginBottom={2}>
        <Button type="submit" variant="contained" color="primary" sx={{ width: "auto" }}>
          Enviar
        </Button>
      </Box>

      {/* Snackbar con el mensaje de éxito o error */}
      <Snackbar
        open={openSnackbar}
        autoHideDuration={3000}
        onClose={handleCloseSnackbar}
      >
        <Alert onClose={handleCloseSnackbar} severity={message === "Instrucciones enviadas correctamente" ? "success" : "error"} sx={{ width: "100%" }}>
          {message}
        </Alert>
      </Snackbar>
    </form>
  );
};

export default Formulario;
