// pages/seat-select/index.js
const db = wx.cloud.database()
const _ = db.command
const app = getApp()

Page({
  data: {
    flight: {},     // 当前航班信息
    seats: [],      // 座位列表
    seatRows: [],   // 按行分组的座位
    selectedSeat: null, // 当前选中的座位对象
    availableCount: 0,
    submitting: false,  // 防止重复下单
    seatPriceInfo: null, // 选中座位的加价信息
    companionMode: false, // 同行人选座模式
    companionSeats: [],   // 同行人已选座位列表
    companionCount: 1,   // 同行人数
    recommendedSeats: [],
    showRecommendPanel: false,
    view3D: false,
    isFullSeat: false,
    hasSeats: false,
    companionHasSeats: false
  },

  onLoad(options) {
    // 1. 解析上一页传来的航班信息
    if (options.flight) {
      const flight = JSON.parse(decodeURIComponent(options.flight))
      this.setData({ flight })
      
      // 2. 去数据库查这个航班的座位
      this.getSeats(flight._id)
    }
  },

  // 获取座位库存
  getSeats(flightId, isRefresh = false) {
    
    // 只有在"非下拉刷新"（即第一次进入）时，才显示全屏转圈
    if (!isRefresh) {
      wx.showLoading({ title: '加载座位...' })
    }

    const MAX_LIMIT = 20
    db.collection('seats')
      .where({ flight_id: flightId })
      .count()
      .then(countRes => {
        const total = countRes.total
        const batchTimes = Math.ceil(total / MAX_LIMIT)
        const allResults = []
        for (let i = 0; i < batchTimes; i++) {
          allResults.push(
            db.collection('seats')
              .where({ flight_id: flightId })
              .orderBy('seat_no', 'asc')
              .skip(i * MAX_LIMIT)
              .limit(MAX_LIMIT)
              .get()
          )
        }
        return Promise.all(allResults)
      })
      .then(results => {
        let allData = []
        results.forEach(res => { allData = allData.concat(res.data) })
        allData.sort((a, b) => a.seat_no.localeCompare(b.seat_no))
        const availableCount = allData.filter(s => s.status === 0).length
        // 按行分组
        const rowMap = {}
        allData.forEach(seat => {
          const rowLabel = seat.seat_no.replace(/[A-Z]/g, '')
          if (!rowMap[rowLabel]) rowMap[rowLabel] = []
          rowMap[rowLabel].push(seat)
        })
        const seatRows = Object.keys(rowMap).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(key => ({
          rowLabel: key,
          seats: rowMap[key]
        }))
        // 计算每个座位的加价信息和预计算属性
        const totalRows = seatRows.length
        allData.forEach(seat => {
          seat.priceAddon = this.calcSeatPriceAddon(seat.seat_no, totalRows)
          // 预计算列字母、行号、是否过道、是否靠窗、是否已售
          const col = seat.seat_no.replace(/[0-9]/g, '')
          const row = seat.seat_no.replace(/[A-Z]/g, '')
          seat.seatCol = col
          seat.seatRow = row
          seat.isAisle = col === 'C'
          seat.isWindow = col === 'A' || col === 'F'
          seat.isSold = seat.status > 0
        })
        this.setData({ seats: allData, seatRows, availableCount })
        // 预计算WXML中需要的布尔属性
        this.setData({
          isFullSeat: availableCount === 0 && allData.length > 0,
          hasSeats: allData.length > 0,
          companionHasSeats: this.data.companionMode && this.data.companionSeats.length > 0
        })
        
        if (isRefresh) {
          wx.stopPullDownRefresh()
          wx.showToast({
            title: '座位状态已更新',
            icon: 'success',
            duration: 1500,
            mask: true
          })
        } else {
          wx.hideLoading()
        }
      })
      .catch(err => {
        console.error('加载座位失败', err)
        
        if (isRefresh) {
          wx.stopPullDownRefresh()
          wx.showToast({ title: '刷新失败', icon: 'none', duration: 2000 })
        } else {
          wx.hideLoading()
          wx.showToast({ title: '加载出错', icon: 'none' })
        }
      })
  },

  // 下拉刷新监听
  onPullDownRefresh() {
    if (this.data.flight._id) {
      this.getSeats(this.data.flight._id, true)
    }
  },

  // 切换同行人选座模式
  onToggleCompanion() {
    const companionMode = !this.data.companionMode
    this.setData({
      companionMode,
      companionSeats: [],
      companionCount: 1,
      companionHasSeats: false
    })
    if (companionMode) {
      wx.showToast({ title: '已开启同行人选座', icon: 'none', duration: 1000 })
    }
  },

  // 增加同行人数
  onAddCompanion() {
    if (this.data.companionCount >= 5) {
      wx.showToast({ title: '最多5位同行人', icon: 'none' })
      return
    }
    this.setData({ companionCount: this.data.companionCount + 1 })
  },

  // 减少同行人数
  onReduceCompanion() {
    if (this.data.companionCount <= 1) return
    const newCount = this.data.companionCount - 1
    // 如果同行人座位多于人数，移除最后一个
    const companionSeats = this.data.companionSeats.slice(0, newCount - 1)
    this.setData({ companionCount: newCount, companionSeats })
  },

  // 显示座位推荐
  onShowRecommend() {
    const { seats, seatRows } = this.data
    const available = seats.filter(s => s.status === 0)
    if (available.length === 0) {
      wx.showToast({ title: '暂无可用座位', icon: 'none' })
      return
    }
    // 推荐算法：评分排序
    const scored = available.map(seat => {
      let score = 50 // 基础分
      const row = parseInt(seat.seat_no.replace(/[A-Z]/g, '')) || 1
      const col = seat.seat_no.replace(/[0-9]/g, '')
      // 靠窗加分（视野好）
      if (col === 'A' || col === 'F') score += 15
      // 过道加分（方便出入）
      if (col === 'C' || col === 'D') score += 10
      // 中排加分（噪音小，平稳）
      const totalRows = seatRows.length
      if (row > totalRows * 0.3 && row < totalRows * 0.7) score += 10
      // 前排加分（下机快）
      if (row <= 3) score += 8
      // 避开最后排（噪音大，空间小）
      if (row >= totalRows - 1) score -= 15
      // 紧急出口排加分（腿部空间大）
      if (row === Math.ceil(totalRows * 0.4)) score += 12
      return { ...seat, score }
    })
    scored.sort((a, b) => b.score - a.score)
    const recommended = scored.slice(0, 3).map((s, i) => ({
      ...s,
      rank: i + 1,
      reason: this.getRecommendReason(s)
    }))
    this.setData({ recommendedSeats: recommended, showRecommendPanel: true })
  },

  // 获取推荐理由
  getRecommendReason(seat) {
    const reasons = []
    const col = seat.seat_no.replace(/[0-9]/g, '')
    const row = parseInt(seat.seat_no.replace(/[A-Z]/g, '')) || 1
    if (col === 'A' || col === 'F') reasons.push('靠窗视野好')
    if (col === 'C' || col === 'D') reasons.push('过道方便出入')
    if (row <= 3) reasons.push('前排下机快')
    if (seat.score >= 70) reasons.push('综合评分高')
    return reasons.join('，')
  },

  // 关闭推荐面板
  onCloseRecommend() {
    this.setData({ showRecommendPanel: false })
  },

  // 选择推荐座位
  onSelectRecommend(e) {
    const seat = e.currentTarget.dataset.seat
    this.setData({ showRecommendPanel: false })
    this.onSelectSeat({ currentTarget: { dataset: { seat } } })
  },

  // 关闭座位信息卡片（取消选择）
  onCloseSeatCard() {
    this.setData({ selectedSeat: null, seatPriceInfo: null })
  },

  // 计算座位加价
  calcSeatPriceAddon(seatNo, totalRows) {
    const row = parseInt(seatNo.replace(/[A-Z]/g, '')) || 1
    const col = seatNo.replace(/[0-9]/g, '')
    let addon = 0
    let zone = 'standard'
    // 前排加价（前3排）
    if (row <= 3) {
      addon += 50
      zone = 'front'
    } else if (row <= 6) {
      addon += 20
      zone = 'midfront'
    }
    // 靠窗加价
    if (col === 'A' || col === 'F') {
      addon += 10
    }
    return { addon, zone }
  },

  // 返回确认：已选座位但未下单时提示
  onBeforeBack() {
    if (this.data.selectedSeat) {
      wx.showModal({
        title: '提示',
        content: '您已选择座位但尚未下单，确定要离开吗？',
        confirmText: '离开',
        cancelText: '留下',
        success: (res) => {
          if (res.confirm) {
            wx.navigateBack()
          }
        }
      })
    } else {
      wx.navigateBack()
    }
  },

  // 用户点击某个座位
  onSelectSeat(e) {
    const seat = e.currentTarget.dataset.seat
    
    // 严谨性：如果座位已售(status > 0)，禁止选择
    if (seat.status > 0) {
      wx.showToast({ title: '该座位已被占用', icon: 'none' })
      return
    }

    // 再次点击已选座位则取消选择
    if (this.data.selectedSeat && this.data.selectedSeat._id === seat._id) {
      this.setData({ selectedSeat: null })
      return
    }

    this.setData({ selectedSeat: seat })
    // 计算座位价格信息
    const priceInfo = seat.priceAddon || this.calcSeatPriceAddon(seat.seat_no, this.data.seatRows.length)
    const basePrice = this.data.flight.price || 0
    this.setData({
      seatPriceInfo: {
        ...priceInfo,
        totalPrice: basePrice + priceInfo.addon,
        hasAddon: priceInfo.addon > 0
      }
    })
    // 同行人模式下，同时添加到同行人座位列表
    if (this.data.companionMode) {
      const maxSeats = this.data.companionCount - 1 // 减去自己
      const companionSeats = this.data.companionSeats.filter(s => s._id !== seat._id)
      if (companionSeats.length < maxSeats) {
        companionSeats.push(seat)
      } else {
        // 替换最后一个
        companionSeats[companionSeats.length - 1] = seat
      }
      this.setData({ companionSeats, companionHasSeats: companionSeats.length > 0 })
    }
    // 触发选座提示动画
    this.playSeatTipAnimation()
  },

  // 选座提示动画
  playSeatTipAnimation() {
    const animation = wx.createAnimation({
      duration: 300,
      timingFunction: 'ease-out'
    })
    animation.opacity(1).translateY(0).step()
    this.setData({ tipAnimation: animation.export() })
    // 2秒后淡出
    setTimeout(() => {
      const fadeOut = wx.createAnimation({
        duration: 500,
        timingFunction: 'ease-in'
      })
      fadeOut.opacity(0).step()
      this.setData({ tipAnimation: fadeOut.export() })
    }, 2000)
  },

  // 切换3D预览
  onToggle3DView() {
    const view3D = !this.data.view3D
    this.setData({ view3D })
  },

  // 提交订单 (核心事务 - 逻辑已修正)
  onSubmitOrder() {
    if (!this.data.selectedSeat) return
    // 防止重复点击
    if (this.data.submitting) return
    
    // 二次确认
    const totalPrice = this.data.seatPriceInfo ? this.data.seatPriceInfo.totalPrice : this.data.flight.price
    const addon = this.data.seatPriceInfo ? this.data.seatPriceInfo.addon : 0
    const companionTotal = this.data.companionSeats.reduce((sum, s) => {
      const p = s.priceAddon || { addon: 0 }
      return sum + (this.data.flight.price + p.addon)
    }, 0)
    const grandTotal = totalPrice + companionTotal
    let priceText = `票价：¥${this.data.flight.price}`
    if (addon > 0) {
      priceText += ` + 选座费：¥${addon} = ¥${totalPrice}`
    }
    if (this.data.companionSeats.length > 0) {
      priceText += `\n同行人${this.data.companionSeats.length}位：¥${companionTotal}`
      priceText += `\n合计：¥${grandTotal}`
    }
    wx.showModal({
      title: '确认下单',
      content: `确认预订 ${this.data.flight.flight_no} 航班 ${this.data.selectedSeat.seat_no} 座位${this.data.companionSeats.length > 0 ? `及同行人${this.data.companionSeats.length}个座位` : ''}？\n${priceText}`,
      confirmText: '确认预订',
      success: (res) => {
        if (res.confirm) {
          this.doSubmitOrder()
        }
      }
    })
  },

  doSubmitOrder() {
    if (!this.data.selectedSeat) return
    if (this.data.submitting) return
    this.setData({ submitting: true })

    // 1. 校验用户登录状态 (直接读缓存，保证速度)
    const user = wx.getStorageSync('currentUser')
    if (!user || !user.nickName) { 
      this.setData({ submitting: false })
      wx.showModal({
        title: '提示',
        content: '请先去“我的”页面登录并完善个人信息',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/profile/index' })
          }
        }
      })
      return
    }

    wx.showLoading({ title: '正在处理...' })
    const { flight, selectedSeat } = this.data

    // 🔥 核心修改：先锁座，再下单！
    // 这样可以确保只有真正抢到座位的人，才能生成订单
    
    // 第一步：尝试修改座位状态（条件更新，只有status仍为0时才锁定）
    db.collection('seats').where({
      _id: selectedSeat._id,
      status: 0
    }).update({
      data: { status: 2 }
    }).then(res => {
      // res.stats.updated 表示实际更新的行数
      // 如果是 0，说明座位可能刚刚被别人抢走了，或者权限不够
      if (res.stats.updated === 0) {
        throw new Error('座位锁定失败，可能已被抢购')
      }

      // 第二步：座位锁定成功，才创建订单
      return db.collection('orders').add({
        data: {
          flight_id: flight._id,
          flight_info: flight, 
          seat_id: selectedSeat._id,
          seat_no: selectedSeat.seat_no,
          passenger_name: user.nickName, 
          passenger_avatar: user.avatarUrl,
          price: flight.price,
          status: 1, 
          create_time: new Date()
        }
      })
    }).then(res => {
      // 第三步：全部成功
      console.log('订单创建成功, ID:', res._id)
      this.setData({ submitting: false })
      wx.hideLoading()
      wx.showToast({ title: '预订成功', icon: 'success' })
      
      setTimeout(() => {
        wx.switchTab({
          url: '/pages/order-list/index'
        })
      }, 1500)
    }).catch(err => {
      console.error('交易失败', err)
      this.setData({ submitting: false })
      wx.hideLoading()
      
      // 区分错误类型提示
      let errMsg = '下单失败，请重试'
      if (err.message && err.message.includes('座位锁定失败')) {
        errMsg = '手慢了，座位已被抢走'
        // 刷新一下座位图
        this.getSeats(flight._id)
      } else {
        // 座位锁定成功但订单创建失败，需要回滚座位状态
        db.collection('seats').doc(selectedSeat._id).update({
          data: { status: 0 }
        }).catch(e => console.error('回滚座位失败', e))
        errMsg = '下单失败，座位已释放，请重试'
      }

      wx.showModal({
        title: '提示',
        content: errMsg,
        showCancel: false
      })
    })
  }
})