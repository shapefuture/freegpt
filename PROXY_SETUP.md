# Proxy Configuration Guide

This application supports using HTTP and SOCKS5 proxies for all browser connections, including a built-in free rotating proxy system. This can be useful for:

- Bypassing IP-based rate limits
- Accessing region-restricted content
- Avoiding IP bans
- Distributing requests across multiple IPs
- Enhancing privacy and anonymity

## Free Rotating Proxy System

The application includes a built-in free rotating proxy system that automatically fetches, tests, and rotates through free proxies from various providers:

- **ProxyScrape**: Free datacenter proxies
- **Proxifly**: Free proxies from over 100 countries
- **Free Proxy List**: Community-maintained proxy lists

To use the free rotating proxy system:

1. Leave the `PROXY_SERVER_URL` environment variable empty
2. The system will automatically fetch and test free proxies on startup
3. Visit `/free-proxy.html` to manage and monitor the free proxy system
4. Use the API endpoints at `/api/free-proxy/*` to programmatically manage proxies

## Setting Up a Proxy

### 1. Environment Variable Configuration

Set the `PROXY_SERVER_URL` environment variable in your `.env` file:

```
# HTTP proxy example
PROXY_SERVER_URL=http://username:password@host:port

# SOCKS5 proxy example
PROXY_SERVER_URL=socks5://username:password@host:port
```

### 2. Proxy Formats

The application supports the following proxy formats:

- **HTTP Proxy**: `http://username:password@host:port`
- **HTTPS Proxy**: `https://username:password@host:port`
- **SOCKS5 Proxy**: `socks5://username:password@host:port`

If your proxy doesn't require authentication, you can omit the username and password:

```
PROXY_SERVER_URL=http://host:port
```

### 3. Testing Your Proxy

After configuring your proxy, you can test it by:

1. Starting the application with the proxy configured
2. Visiting `/proxy-test.html` in your browser
3. Clicking the "Check IP Address" button

The page will show your current IP address as seen by external services, which should be the IP of your proxy server if configured correctly.

You can also check the proxy status programmatically by making a GET request to `/api/ip-check`.

## Proxy Providers

Here are some popular proxy providers you might consider:

- [Bright Data](https://brightdata.com/) - Residential, datacenter, and mobile proxies
- [Oxylabs](https://oxylabs.io/) - Residential and datacenter proxies
- [SmartProxy](https://smartproxy.com/) - Residential and datacenter proxies
- [IPRoyal](https://iproyal.com/) - Residential and datacenter proxies
- [ProxyMesh](https://proxymesh.com/) - HTTP proxies with multiple locations

## Troubleshooting

### Common Issues

1. **Connection Errors**: If you see connection errors, verify that your proxy server is online and accessible.

2. **Authentication Failures**: Double-check your username and password if you're getting authentication errors.

3. **Slow Performance**: Proxies can sometimes slow down connections. If performance is an issue, try a different proxy server or provider.

4. **HTTPS Issues**: Some proxies may have issues with HTTPS connections. Make sure your proxy supports HTTPS traffic.

### Checking Logs

Check the application logs for any proxy-related errors:

```
grep -i proxy logs/app.log
```

## Security Considerations

- Always use secure, trusted proxy providers
- Be aware that free proxies may log your traffic or inject ads
- Consider using encrypted connections (HTTPS) when possible
- Regularly rotate proxy credentials for better security
