FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /home/node/.minecraft && chown -R node:node /home/node/.minecraft /app
USER node
EXPOSE 8080
CMD ["npm", "start"]
