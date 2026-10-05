FROM node:14
#create work app directory
WORKDIR /app
#copia  ambos archivos package.json
COPY package*.json ./
#INSTALA LAS DEPENDENCIAS
RUN npm install
#COPIA LOS ARCHIVOS DENTRO DEL CONTENEDOR DE DOCKER /app
COPY . .
EXPOSE 3000


CMD [ "node","src/index.js" ]