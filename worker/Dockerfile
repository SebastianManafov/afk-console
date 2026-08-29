FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS mcc-build
RUN apk add --no-cache git
WORKDIR /src
COPY mcc-proxy-only.patch /tmp/mcc-proxy-only.patch
RUN git clone --recurse-submodules https://github.com/MCCTeam/Minecraft-Console-Client.git mcc \
  && cd mcc \
  && git checkout bff5ee769c76f0d6ef62533ddff6d18b2478f570 \
  && git submodule update --init --recursive \
  && git apply /tmp/mcc-proxy-only.patch
WORKDIR /src/mcc
RUN dotnet publish MinecraftClient/MinecraftClient.csproj -c Release -r linux-musl-x64 --self-contained true -o /out/mcc

FROM node:22-alpine
RUN apk add --no-cache icu-libs libgcc libstdc++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY --from=mcc-build /out/mcc /opt/mcc
RUN chmod +x /opt/mcc/MinecraftClient
RUN mkdir -p /home/node/.minecraft && chown -R node:node /home/node/.minecraft /app
USER node
EXPOSE 3000
CMD ["npm", "start"]
