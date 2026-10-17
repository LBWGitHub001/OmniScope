#ifndef OMNISCOPE_LOGGER_INTERNAL_TRANSPORT_HPP
#define OMNISCOPE_LOGGER_INTERNAL_TRANSPORT_HPP

#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/uio.h>

#include <cstddef>
#include <cstdint>
#include <string>

namespace omniscope
{
namespace logger
{

// L0：UDP 套接字传输层。
class UdpSocket
{
public:
  UdpSocket() = default;
  UdpSocket(const UdpSocket &) = delete;
  UdpSocket & operator=(const UdpSocket &) = delete;
  ~UdpSocket() { close(); }

  bool bind(uint16_t port, bool broadcast, bool reuse_port = false);
  void close();
  bool valid() const { return fd_ >= 0; }

  ssize_t recvfrom_nb(void * buf, size_t len, sockaddr_in * from);
  bool sendto(const void * data, size_t len, const sockaddr_in & dest) const;
  bool sendto(const void * data, size_t len, in_addr ip, uint16_t port) const;
  bool sendmsg(const struct iovec * iov, int iovcnt, const sockaddr_in & dest) const;

private:
  int fd_{-1};
};

std::string local_ipv4();
std::string ip_string(in_addr ip);
sockaddr_in broadcast_addr(uint16_t port);

}  // namespace logger
}  // namespace omniscope

#endif  // OMNISCOPE_LOGGER_INTERNAL_TRANSPORT_HPP
